import type { CvProfileView } from '@/lib/sanad-snapshot';
import { normalizeArabic, tokenize } from '../../text/arabic';
import { canonicalSkill, findSkills, skillGroup } from '../skills-taxonomy';

export interface MatchableJob { title: string; english: string; description: string; skills: readonly string[] }
export interface MatchResult { score: number; reason: string; matchedSkills: string[] }

const STOP = new Set(['في', 'من', 'الى', 'علي', 'عن', 'مع', 'and', 'of', 'the', 'for', 'a', 'an', 'و', 'او', 'specialist', 'اخصائي']);
const titleTokens = (value: string) => tokenize(value).filter(token => token.length > 2 && !STOP.has(token));

function listAr(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join('، ')} و${items[items.length - 1]}`;
}

/**
 * Transparent, deterministic matching (no black box): skills overlap is the main signal,
 * then skill families, then how close previous job titles are to this role.
 */
/** Same skill? Canonical names first, then containment / shared words for skills outside the taxonomy. */
export function skillsMatch(a: string, b: string): boolean {
  const left = normalizeArabic(canonicalSkill(a));
  const right = normalizeArabic(canonicalSkill(b));
  if (left === right) return true;
  if (Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left))) return true;
  const leftWords = new Set(tokenize(left).filter(word => word.length > 2 && !STOP.has(word)));
  const rightWords = tokenize(right).filter(word => word.length > 2 && !STOP.has(word));
  if (!leftWords.size || !rightWords.length) return false;
  const shared = rightWords.filter(word => leftWords.has(word)).length;
  return shared / new Set([...leftWords, ...rightWords]).size >= 0.5;
}

export function matchJob(profile: CvProfileView, job: MatchableJob): MatchResult {
  const candidateSkills = [...profile.skills, ...profile.languages];
  const jobSkills = [...new Set([...job.skills.map(canonicalSkill), ...findSkills(`${job.description}`)])];
  const matched = jobSkills.filter(skill => candidateSkills.some(own => skillsMatch(own, skill)));
  // Role-specific skills count fully; soft skills and languages count half.
  const weight = (skill: string) => ['soft', 'language'].includes(skillGroup(skill) ?? '') ? 0.5 : 1;
  const skillScore = jobSkills.length ? matched.reduce((sum, skill) => sum + weight(skill), 0) / Math.min(jobSkills.length, 6) : 0;

  const profileGroups = new Set(profile.skills.map(skillGroup).filter((group): group is string => Boolean(group) && group !== 'soft' && group !== 'language'));
  const jobGroups = new Set(jobSkills.map(skillGroup).filter((group): group is string => Boolean(group) && group !== 'soft' && group !== 'language'));
  const sharedGroups = [...jobGroups].filter(group => profileGroups.has(group));
  const groupScore = jobGroups.size ? sharedGroups.length / jobGroups.size : 0;

  const roleTokens = new Set(titleTokens(`${job.title} ${job.english}`));
  // Titles actually held count fully; roles the CV agent merely suggests count half.
  const sharesToken = (title: string) => titleTokens(title).some(token => roleTokens.has(token));
  const heldTitle = profile.jobTitles.find(sharesToken);
  const titleHit = heldTitle ?? profile.suggestedRoles.find(sharesToken);
  const titleScore = heldTitle ? 1 : titleHit ? 0.5 : 0;
  const experienceScore = profile.yearsExperience ? Math.min(profile.yearsExperience / 3, 1) : profile.experience.length ? 0.5 : 0;

  const raw = Math.min(skillScore, 1) * 0.6 + groupScore * 0.17 + titleScore * 0.15 + experienceScore * 0.08;
  const score = Math.max(15, Math.min(98, Math.round(30 + raw * 70 - (matched.length ? 0 : 15))));

  let reason: string;
  if (matched.length >= 2) reason = `لأن مهاراتك في ${listAr(matched.slice(0, 3))} تتوافق مع متطلبات الدور.`;
  else if (matched.length === 1 && titleHit) reason = `لأن خبرتك في ${titleHit} ومهارة ${matched[0]} قريبة من هذا الدور.`;
  else if (matched.length === 1) reason = `لأن مهارة ${matched[0]} من متطلبات الدور، ويمكنك تطوير بقية المهارات.`;
  else if (titleHit) reason = `لأن خبرتك في ${titleHit} قريبة من هذا الدور.`;
  else {
    const missing = jobSkills.slice(0, 2);
    reason = missing.length ? `توافق أولي؛ تحتاج إلى تطوير مهارات مثل ${listAr(missing)}.` : 'توافق أولي مع مهاراتك الحالية.';
  }
  return { score, reason, matchedSkills: matched };
}

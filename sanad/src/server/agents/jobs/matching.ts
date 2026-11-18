import type { CvProfileView } from '@/lib/sanad-snapshot';
import { normalizeArabic, tokenize, uniqueStrings } from '../../text/arabic';
import { canonicalSkill, findSkills, mentionsSkill, skillGroup, withImpliedSkills } from '../skills-taxonomy';

export interface MatchableJob { title: string; english: string; description: string; skills: readonly string[]; location?: string; mode?: string }
export interface MatchResult { score: number; reason: string; matchedSkills: string[]; missingSkills: string[] }
type MatchProfile = Pick<CvProfileView, 'skills' | 'languages' | 'jobTitles' | 'suggestedRoles' | 'yearsExperience' | 'experience' | 'education'> & Partial<Pick<CvProfileView, 'searchKeywords' | 'ats'>>;

// Words that say nothing about the role itself (normalised like the titles they are compared with).
const STOP = new Set(['في', 'من', 'إلى', 'على', 'عن', 'مع', 'and', 'of', 'the', 'for', 'a', 'an', 'و', 'أو', 'specialist', 'أخصائي', 'اخصائية', 'trainee', 'intern', 'co-op', 'junior', 'senior', 'lead', 'متدرب', 'متدربة', 'مبتدئ', 'أول', 'digital', 'رقمي', 'services', 'service', 'quality', 'officer', 'موظف', 'assistant', 'مساعد', 'core', 'member', 'عضو'].map(normalizeArabic));
// Role words in both languages, so «أخصائي موارد بشرية» meets «Head of Human Resources» and «HR Specialist».
const ROLE_WORDS: Record<string, string[]> = {
  hr: ['human', 'resources'], ai: ['artificial', 'intelligence'], ml: ['machine', 'learning'], bi: ['business', 'intelligence'], it: ['information', 'technology'], ui: ['interface'], ux: ['experience'], qa: ['quality'],
  موارد: ['human', 'resources', 'hr'], بشريه: ['human'], توظيف: ['recruitment', 'talent'], محاسب: ['accountant', 'accounting'], محاسبه: ['accountant', 'accounting'], مالي: ['finance', 'financial'],
  مهندس: ['engineer'], هندسه: ['engineering', 'engineer'], ميكانيكي: ['mechanical'], كهربائي: ['electrical'], مدني: ['civil'], محلل: ['analyst'], بيانات: ['data'],
  مطور: ['developer', 'engineer'], برمجيات: ['software'], مصمم: ['designer'], ممرض: ['nurse', 'nursing'], ممرضه: ['nurse', 'nursing'], تسويق: ['marketing'], مبيعات: ['sales'],
  امن: ['security'], سيبراني: ['cybersecurity', 'cyber'], ذكاء: ['ai', 'artificial', 'intelligence'], اصطناعي: ['ai', 'artificial'], اداري: ['administrative', 'admin'],
  معلم: ['teacher'], مدرب: ['trainer'], صيدلي: ['pharmacist'], فني: ['technician'], عملاء: ['customer'], مشتريات: ['procurement'], مشاريع: ['project'], جوده: ['quality'],
};
export const titleTokens = (value: string) => {
  const tokens = tokenize(value).filter(token => (token.length > 2 || ROLE_WORDS[token]) && !STOP.has(token));
  return [...new Set([...tokens, ...tokens.flatMap(token => ROLE_WORDS[token] ?? [])])].filter(token => token.length > 1);
};

function listAr(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join('، ')} و${items[items.length - 1]}`;
}
const arNumber = (value: number) => value.toLocaleString('ar-SA');

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

/**
 * Job Matching agent — ATS-style, transparent and deterministic (the % is a real comparison):
 *  - requirements / keywords (55%): every skill the job asks for is looked up in the candidate's
 *    skills (and the broader skills their tools prove) and in the full CV text, under all its spellings;
 *  - related experience (20%): titles actually held, then roles the CV suits — only with skill overlap;
 *  - experience level vs. the years the posting asks for (10%), required degree (5%), location / work mode (10%).
 * The reason lists the matched requirements and the gaps.
 */
export function matchJob(profile: MatchProfile, job: MatchableJob, cvText = ''): MatchResult {
  const normalizedCv = cvText ? normalizeArabic(cvText) : '';
  const own = [...profile.skills, ...profile.languages];
  const candidate = withImpliedSkills(own);
  // A named tool («AutoCAD», «TypeScript», «Salesforce») needs that tool; a skill («CRM», «تحليل البيانات») accepts its tools.
  const strict = (skill: string) => !/[ء-ي]/.test(skill) && normalizeArabic(canonicalSkill(skill)) !== normalizeArabic(skill);
  // Requirements keep the job's own wording (shown in the reason); matching uses the shared skill name.
  const requirements = new Map<string, string>();
  for (const skill of [...job.skills, ...findSkills(job.description)]) {
    const id = strict(skill) ? normalizeArabic(skill) : normalizeArabic(canonicalSkill(skill));
    if (skill.trim() && !requirements.has(id)) requirements.set(id, skill.trim());
  }
  const jobSkills = [...requirements.values()];
  const has = (skill: string) => (strict(skill)
    ? own.some(item => normalizeArabic(item) === normalizeArabic(skill))
    : candidate.some(item => skillsMatch(item, skill))) || (normalizedCv !== '' && mentionsSkill(normalizedCv, skill));
  const matched = jobSkills.filter(has);
  const missing = jobSkills.filter(skill => !matched.includes(skill));
  // Role-specific skills count fully; soft skills and languages count half.
  const weight = (skill: string) => ['soft', 'language'].includes(skillGroup(skill) ?? '') ? 0.5 : 1;
  const totalWeight = jobSkills.reduce((sum, skill) => sum + weight(skill), 0);
  const keywordScore = jobSkills.length ? Math.min(1, matched.reduce((sum, skill) => sum + weight(skill), 0) / Math.min(totalWeight, 6)) : 0;
  const hardMatched = matched.filter(skill => weight(skill) === 1);

  const roleTokens = new Set(titleTokens(`${job.title} ${job.english}`));
  const sharesToken = (title: string) => titleTokens(title).some(token => roleTokens.has(token));
  // Titles actually held count fully; roles the CV suits count less.
  const heldTitle = profile.jobTitles.find(sharesToken);
  const suitedTitle = heldTitle ? undefined : [...profile.suggestedRoles, ...(profile.searchKeywords ?? [])].find(sharesToken);
  const titleScore = heldTitle ? 1 : suitedTitle ? 0.6 : 0;

  const required = /(\d{1,2})\s*\+?\s*(?:سنوات|سنة|سنه|years?|yrs)/i.exec(normalizeArabic(job.description));
  const years = profile.yearsExperience ?? 0;
  const experienceScore = required ? Math.min(1, years / Math.max(1, Number(required[1]))) : years >= 1 ? 1 : years > 0 ? 0.75 : profile.experience.length ? 0.5 : 0.3;
  const needsDegree = /(بكالوريوس|bachelor|degree|شهاده جامعيه|university)/i.test(normalizeArabic(job.description));
  const educationScore = profile.education.length ? 1 : needsDegree ? 0.2 : 0.6;
  const mode = normalizeArabic(job.mode ?? '');
  const city = profile.ats?.contact.city ? normalizeArabic(profile.ats.contact.city) : '';
  const location = normalizeArabic(job.location ?? '');
  const locationScore = /بعد|remote/.test(mode) || /بعد|remote/.test(location) ? 1 : city && location && (location.includes(city) || city.includes(location)) ? 1 : /هجين|hybrid/.test(mode) ? 0.7 : 0.5;

  // A similar title alone must not lift the score: it counts fully only when real skills overlap too.
  const relevance = titleScore * (hardMatched.length ? 1 : 0.4);
  const raw = keywordScore * 0.55 + relevance * 0.2 + experienceScore * 0.1 + educationScore * 0.05 + locationScore * 0.1;
  // The percentage is the weighted comparison itself (no base score); nothing in common stays low.
  const score = Math.max(5, Math.min(98, Math.round(raw * 100 * (matched.length ? 1 : 0.6))));

  let reason: string;
  const gap = missing.length ? `؛ ينقصك: ${listAr(missing.slice(0, 2))}` : '';
  if (matched.length >= 2) reason = `لأن سيرتك تحتوي ${arNumber(matched.length)} من ${arNumber(jobSkills.length)} كلمات مفتاحية للدور (${listAr(matched.slice(0, 3))})${gap}.`;
  else if (matched.length === 1 && heldTitle) reason = `لأن خبرتك في ${heldTitle} ومهارة ${matched[0]} قريبة من هذا الدور${gap}.`;
  else if (matched.length === 1 && suitedTitle) reason = `لأن سيرتك تناسب دور ${suitedTitle}، ومهارة ${matched[0]} من متطلباته${gap}.`;
  else if (matched.length === 1) reason = `لأن مهارة ${matched[0]} من متطلبات الدور${gap}.`;
  else if (heldTitle) reason = `لأن خبرتك في ${heldTitle} قريبة من هذا الدور${gap}.`;
  else if (suitedTitle) reason = `لأن سيرتك تناسب دور ${suitedTitle}${gap}.`;
  else reason = missing.length ? `توافق أولي؛ يطلب الدور مهارات مثل ${listAr(missing.slice(0, 3))}.` : 'توافق أولي مع مهاراتك الحالية.';
  return { score, reason, matchedSkills: matched, missingSkills: missing };
}

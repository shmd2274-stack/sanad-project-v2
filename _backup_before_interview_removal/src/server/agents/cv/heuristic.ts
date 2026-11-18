import type { CvProfileView, ExperienceDetail } from '@/lib/sanad-snapshot';
import { normalizeArabic, uniqueStrings } from '../../text/arabic';
import { skillGroup } from '../skills-taxonomy';
import { arDigits, durationAr, formatEducation, formatExperience, monthsOf, parseEducation, parseExperience, periodAr, totalYears, type ExperienceItem } from './experience';
import { cvLines, linesOf, splitSections } from './sections';
import { extractLanguages, extractSkills } from './skills-extract';

/**
 * Offline CV reader: no network, deterministic, fast enough for bulk processing.
 * Reads the CV section by section like a recruiter. Used alone without Claude, and as a cross-check with it.
 */
const DEGREE = /(بكالوريوس|بكالريوس|ماجستير|دكتوراه|دبلوم|ثانوي|bachelor|master|phd|diploma|degree|b\.?sc|m\.?sc|mba)/i;
const CERTIFICATE = /(شهاده|دوره|برنامج تدريبي|رخصه|certificate|certification|certified|course|license|bootcamp)/i;
const YEARS_STATED = /(\d{1,2})\+?\s*(?:سنوات|سنه|عام|اعوام|years?|yrs)\s*(?:من\s*)?(?:الخبره|خبره|of experience|experience)/i;

const ROLE_BY_GROUP: Record<string, string> = {
  data: 'محلل بيانات', software: 'مطور برمجيات', design: 'مصمم جرافيك وتجربة مستخدم', admin: 'موظف إداري ومدخل بيانات',
  service: 'أخصائي تسويق رقمي وخدمة عملاء', finance: 'محاسب', operations: 'أخصائي عمليات ومستودعات', health: 'أخصائي رعاية صحية',
  education: 'مدرب ومعلم', engineering: 'مهندس', legal: 'أخصائي قانوني وامتثال', media: 'صانع ومحرر محتوى', hospitality: 'موظف ضيافة', crafts: 'فني صيانة وحرف',
};
const ROLE_EN: Record<string, string> = {
  data: 'Data Analyst', software: 'Software Developer', design: 'Graphic UI/UX Designer', admin: 'Administrative Assistant Data Entry',
  service: 'Digital Marketing Customer Service', finance: 'Accountant', operations: 'Operations Warehouse', health: 'Healthcare',
  education: 'Trainer Teacher', engineering: 'Engineer', legal: 'Legal Compliance', media: 'Content Creator Editor', hospitality: 'Hospitality', crafts: 'Technician',
};

export function careerLevelAr(years: number | null, hasRoles: boolean): string | null {
  if (years === null) return hasRoles ? null : 'حديث تخرج';
  if (years < 1) return 'حديث تخرج / مبتدئ';
  if (years < 3) return 'مبتدئ (أقل من ٣ سنوات)';
  if (years < 6) return 'متوسط الخبرة';
  if (years < 10) return 'خبير';
  return 'خبير أول';
}

export function toDetail(item: ExperienceItem, now = new Date()): ExperienceDetail {
  return { ...item, period: periodAr(item), duration: durationAr(monthsOf(item, now)) };
}

/** Most recent role first: current roles, then by end date, then by start date. */
export function sortRoles(items: ExperienceItem[]): ExperienceItem[] {
  const key = (item: ExperienceItem) => `${item.current ? '9999' : (item.end ?? item.start ?? '0000')}|${item.start ?? ''}`;
  return [...items].sort((a, b) => key(b).localeCompare(key(a)));
}

export function heuristicProfile(text: string, now = new Date()): CvProfileView {
  const sections = splitSections(text);
  const allLines = cvLines(text);
  const experienceLines = linesOf(sections, 'experience', 'volunteer');
  // No experience heading: read dated lines anywhere that are not education or courses.
  const roles = sortRoles(parseExperience(experienceLines.length ? experienceLines
    : allLines.filter(line => !DEGREE.test(normalizeArabic(line)) && !CERTIFICATE.test(normalizeArabic(line)))));

  const educationLines = linesOf(sections, 'education');
  const education = parseEducation(educationLines.length ? educationLines : allLines.filter(line => DEGREE.test(normalizeArabic(line)))).map(formatEducation);
  const certificationLines = linesOf(sections, 'certifications');
  const certifications = uniqueStrings((certificationLines.length ? certificationLines : allLines.filter(line => CERTIFICATE.test(normalizeArabic(line)) && !DEGREE.test(normalizeArabic(line))))
    .map(line => line.replace(/^[•·▪●◦*\-–]\s*/, '').replace(/\s*[-–—|]\s*((?:19|20)\d{2})\s*$/, ' · $1').replace(/(?:19|20)\d{2}/g, year => arDigits(year)))
    .filter(line => line.length >= 4 && line.length <= 140), 8);

  const skills = extractSkills(sections, text);
  const languages = extractLanguages(sections, text);
  const stated = YEARS_STATED.exec(normalizeArabic(text));
  const yearsExperience = totalYears(roles, now) ?? (stated ? Number(stated[1]) : null);

  const groups = new Map<string, number>();
  for (const skill of skills) {
    const group = skillGroup(skill);
    if (group && group !== 'soft' && group !== 'language') groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  const rankedGroups = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([group]) => group);
  const jobTitles = uniqueStrings(roles.map(role => role.title).filter(Boolean), 6);
  const suggestedRoles = uniqueStrings([...jobTitles.slice(0, 2), ...rankedGroups.map(group => ROLE_BY_GROUP[group] ?? '')].filter(Boolean), 5);
  const searchKeywords = uniqueStrings([
    ...jobTitles.slice(0, 3), ...rankedGroups.slice(0, 2).map(group => ROLE_BY_GROUP[group] ?? ''), ...rankedGroups.slice(0, 2).map(group => ROLE_EN[group] ?? ''),
    ...skills.filter(skill => skillGroup(skill) !== 'soft').slice(0, 5),
  ].filter(Boolean), 12);

  // The candidate's own summary when present; otherwise a short neutral one built from what was read.
  const ownSummary = linesOf(sections, 'summary').join(' ').replace(/\s+/g, ' ').trim();
  const latest = roles[0];
  const months = yearsExperience ? Math.round(yearsExperience * 12) : null;
  const generated = [
    latest?.title ? `${latest.title}${months ? ` بخبرة ${durationAr(months)}` : ''}${latest.organization ? `، آخرها لدى ${latest.organization}` : ''}.` : '',
    education[0] ? `المؤهل: ${education[0]}.` : '',
    skills.length ? `من أبرز المهارات: ${skills.filter(skill => skillGroup(skill) !== 'soft').slice(0, 4).join('، ') || skills.slice(0, 4).join('، ')}.` : '',
  ].filter(Boolean).join(' ');
  const summary = ownSummary ? (ownSummary.length > 260 ? `${ownSummary.slice(0, 257).replace(/\s\S*$/, '')}…` : ownSummary) : generated || 'سيرة ذاتية مهنية.';

  return {
    summary,
    skills,
    experience: roles.map(role => formatExperience(role, now)),
    experienceDetails: roles.map(role => toDetail(role, now)),
    education,
    jobTitles,
    languages,
    certifications,
    suggestedRoles,
    searchKeywords,
    careerLevel: careerLevelAr(yearsExperience, roles.length > 0),
    yearsExperience,
    engine: 'heuristic',
  };
}

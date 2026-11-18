import type { CvProfileView, ExperienceDetail } from '@/lib/sanad-snapshot';
import { normalizeArabic, uniqueStrings } from '../../text/arabic';
import { canonicalSkill, skillGroup } from '../skills-taxonomy';
import { atsReport } from './ats';
import { durationAr, findDateRange, formatEducation, formatExperience, monthsOf, parseEducation, parseRoles, periodAr, pieceKind, totalYears, type ExperienceItem, type ParsedRole } from './experience';
import { formatCertification, parseCertifications, parseProjects, toolSkills } from './records';
import { cvLines, linesOf, splitSections } from './sections';
import { extractLanguages, extractSkills, withoutNoise } from './skills-extract';

/**
 * Offline CV reader (ATS-style): no network, deterministic, fast enough for bulk processing.
 * Parses the CV into standard fields like an Applicant Tracking System, then scores it.
 * Used alone without Claude, and as the cross-check and ATS scorer with it.
 */
const DEGREE = /(بكالوريوس|بكالريوس|ماجستير|دكتوراه|دبلوم|ثانوي|bachelor|master|phd|diploma|degree|b\.?sc|m\.?sc|mba)/i;
const CERTIFICATE = /(شهاده|دوره|برنامج تدريبي|رخصه|certificate|certification|certified|course|license|bootcamp)/i;
const YEARS_STATED = /(\d{1,2})\+?\s*(?:سنوات|سنه|عام|اعوام|years?|yrs)\s*(?:من\s*)?(?:الخبره|خبره|of experience|experience)/i;
const INTERN_WORDS = /\b(trainee|intern|internship|co-?op|apprentice)\b|متدرب(ة|ه)?|تدريب تعاوني/gi;

export const PARSER_VERSION = 4;
const GENERIC_SKILLS = new Set(['Excel', 'Microsoft Office', 'Word', 'PowerPoint', 'Outlook وTeams', 'Google Workspace', 'إعداد التقارير', 'الطباعة السريعة', 'ERP']);

const ROLE_BY_GROUP: Record<string, string> = {
  data: 'محلل بيانات', ai: 'أخصائي ذكاء اصطناعي', security: 'أخصائي أمن سيبراني', software: 'مطور برمجيات', design: 'مصمم جرافيك وتجربة مستخدم', admin: 'موظف إداري ومدخل بيانات',
  service: 'أخصائي تسويق رقمي وخدمة عملاء', finance: 'محاسب', hr: 'أخصائي موارد بشرية', operations: 'أخصائي عمليات ومستودعات', health: 'أخصائي رعاية صحية',
  education: 'مدرب ومعلم', engineering: 'مهندس', legal: 'أخصائي قانوني وامتثال', media: 'صانع ومحرر محتوى', hospitality: 'موظف ضيافة', crafts: 'فني صيانة وحرف',
};
const ROLE_EN: Record<string, string> = {
  data: 'Data Analyst', ai: 'AI Engineer', security: 'Cybersecurity Analyst', software: 'Software Developer', design: 'UI/UX Designer', admin: 'Administrative Assistant',
  service: 'Customer Service Specialist', finance: 'Accountant', hr: 'HR Specialist', operations: 'Operations Specialist', health: 'Healthcare Specialist',
  education: 'Trainer', engineering: 'Engineer', legal: 'Compliance Specialist', media: 'Content Creator', hospitality: 'Hospitality', crafts: 'Technician',
};

export function careerLevelAr(years: number | null, hasRoles: boolean, onlyTraining = false): string | null {
  if (onlyTraining && (years ?? 0) < 2) return 'حديث تخرج (تدريب تعاوني)';
  if (years === null) return hasRoles ? null : 'حديث تخرج';
  if (years < 1) return 'حديث تخرج / مبتدئ';
  if (years < 3) return 'مبتدئ (أقل من ٣ سنوات)';
  if (years < 6) return 'متوسط الخبرة';
  if (years < 10) return 'خبير';
  return 'خبير أول';
}

export function toDetail(item: ExperienceItem, now = new Date()): ExperienceDetail {
  return {
    title: item.title, organization: item.organization, location: item.location, start: item.start, end: item.end, current: item.current,
    period: periodAr(item), duration: durationAr(monthsOf(item, now)), highlights: item.highlights, ...(item.kind ? { kind: item.kind } : {}),
  };
}

/** Most recent role first: current roles, then by end date, then by start date. */
export function sortRoles<T extends ExperienceItem>(items: T[]): T[] {
  const key = (item: ExperienceItem) => `${item.current ? '9999' : (item.end ?? item.start ?? '0000')}|${item.start ?? ''}`;
  return [...items].sort((a, b) => key(b).localeCompare(key(a)));
}

/** «Artificial Intelligence Specialist Trainee» → «Artificial Intelligence Specialist» (a role to apply for). */
export function targetTitle(title: string): string | null {
  const clean = title.replace(INTERN_WORDS, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–,]+|[\s\-–,]+$/g, '').trim();
  return clean && pieceKind(clean) === 'title' ? clean : null;
}

/** Work (jobs + internships) first, newest first; then volunteering. */
export function orderRoles<T extends ExperienceItem>(roles: T[]): T[] {
  return [...sortRoles(roles.filter(role => role.kind !== 'volunteer')), ...sortRoles(roles.filter(role => role.kind === 'volunteer'))];
}

export interface CvReadMeta { fileName?: string | undefined; scanned?: boolean | undefined }

export function heuristicProfile(text: string, now = new Date(), meta: CvReadMeta = {}): CvProfileView {
  const sections = splitSections(text);
  const allLines = cvLines(text);
  const experienceLines = linesOf(sections, 'experience');
  const volunteerLines = linesOf(sections, 'volunteer');
  const structured = sections.some(section => section.kind !== 'header');
  // No experience heading: read dated lines anywhere that are not education or courses.
  const fallback = structured && (experienceLines.length || volunteerLines.length) ? [] : allLines.filter(line => !DEGREE.test(normalizeArabic(line)) && !CERTIFICATE.test(normalizeArabic(line)));
  // A «التدريب / Training» section may hold a dated internship rather than courses.
  const certificationSection = linesOf(sections, 'certifications');
  const trainingRoles = parseRoles(certificationSection, 'job').filter(role => role.kind === 'internship' && role.start);
  const parsed: ParsedRole[] = [...parseRoles(experienceLines.length ? experienceLines : fallback, 'job'), ...trainingRoles, ...parseRoles(volunteerLines, 'volunteer')];
  const roles = orderRoles(parsed);
  const work = roles.filter(role => role.kind !== 'volunteer');

  const educationLines = linesOf(sections, 'education');
  const educationItems = parseEducation(educationLines.length ? educationLines : allLines.filter(line => DEGREE.test(normalizeArabic(line))));
  // Courses only: dated ranges and their achievement lines belong to the internship read above.
  const certificationLines = trainingRoles.length ? certificationSection.filter(line => !findDateRange(line) && !trainingRoles.some(role => role.details.some(detail => line.includes(detail.slice(0, 20))))) : certificationSection;
  const certificationItems = parseCertifications(certificationLines.length ? certificationLines
    : allLines.filter(line => CERTIFICATE.test(normalizeArabic(line)) && !DEGREE.test(normalizeArabic(line))));
  const projects = parseProjects(linesOf(sections, 'projects'));

  const ownSummary = linesOf(sections, 'summary').join(' ').replace(/\s+/g, ' ').trim();
  // Skills are mined from achievements, summary and projects — not from organisation names. A CV with
  // no skills section («BLS, ACLS, مكافحة العدوى» on a line of its own) is read in full instead.
  const hasSkillsSection = sections.some(section => section.kind === 'skills');
  const unsectioned = hasSkillsSection ? [] : allLines.filter(line => !DEGREE.test(normalizeArabic(line)));
  const minedText = withoutNoise([ownSummary, ...roles.flatMap(role => role.details), ...projects.map(project => project.description), ...unsectioned].join('\n'));
  const skills = extractSkills(sections, text, {
    projectTools: toolSkills(projects.flatMap(project => project.tools)),
    certificationText: certificationItems.map(item => item.name).join('\n'),
    minedText: minedText || undefined,
  });
  const languages = extractLanguages(sections, text);
  const stated = YEARS_STATED.exec(normalizeArabic(text));
  const yearsExperience = totalYears(work, now) ?? (stated && !work.length ? Number(stated[1]) : null);
  const onlyTraining = work.length > 0 && work.every(role => role.kind === 'internship');

  // Office tools everyone uses (Excel, reports) say nothing about the field: they do not pick the role.
  const groups = new Map<string, number>();
  for (const skill of skills) {
    const group = skillGroup(skill);
    if (group && group !== 'soft' && group !== 'language' && !GENERIC_SKILLS.has(canonicalSkill(skill))) groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  const rankedGroups = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([group]) => group);
  const jobTitles = uniqueStrings(work.map(role => role.title).filter(Boolean), 6);
  const targets = uniqueStrings(work.map(role => role.kind === 'job' ? role.title : targetTitle(role.title) ?? '').filter(Boolean), 3);
  const suggestedRoles = uniqueStrings([...targets.slice(0, 2), ...rankedGroups.slice(0, 4).map(group => ROLE_BY_GROUP[group] ?? '')].filter(Boolean), 5);
  const searchKeywords = uniqueStrings([
    ...targets, ...rankedGroups.slice(0, 3).map(group => ROLE_BY_GROUP[group] ?? ''), ...rankedGroups.slice(0, 3).map(group => ROLE_EN[group] ?? ''),
    ...skills.filter(skill => skillGroup(skill) !== 'soft').slice(0, 6),
  ].filter(Boolean), 14);

  // The candidate's own summary when present; otherwise a short neutral one built from what was read.
  const education = educationItems.map(formatEducation);
  const latest = work[0] ?? roles[0];
  const months = yearsExperience ? Math.round(yearsExperience * 12) : null;
  const generated = [
    latest?.title ? `${latest.title}${months ? ` بخبرة ${durationAr(months)}` : ''}${latest.organization ? `، آخرها لدى ${latest.organization}` : ''}.` : '',
    education[0] ? `المؤهل: ${education[0]}.` : '',
    skills.length ? `من أبرز المهارات: ${skills.filter(skill => skillGroup(skill) !== 'soft').slice(0, 4).join('، ') || skills.slice(0, 4).join('، ')}.` : '',
  ].filter(Boolean).join(' ');
  const summary = ownSummary ? (ownSummary.length > 260 ? `${ownSummary.slice(0, 257).replace(/\s\S*$/, '')}…` : ownSummary) : generated || 'سيرة ذاتية مهنية.';

  const ats = atsReport({
    text, sections, roles, education: educationItems, skills, languages, certifications: certificationItems.length, projects: projects.length,
    hasSummary: ownSummary.split(/\s+/).length >= 12, titles: targets, fileName: meta.fileName, scanned: meta.scanned,
  });

  return {
    summary,
    skills,
    experience: roles.map(role => formatExperience(role, now)),
    experienceDetails: roles.map(role => toDetail(role, now)),
    education,
    jobTitles,
    languages,
    certifications: certificationItems.map(formatCertification),
    suggestedRoles,
    searchKeywords,
    careerLevel: careerLevelAr(yearsExperience, roles.length > 0, onlyTraining),
    yearsExperience,
    projects,
    ats,
    engine: 'heuristic',
  };
}

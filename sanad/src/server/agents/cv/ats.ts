import type { AtsCheck, AtsReport } from '@/lib/sanad-snapshot';
import { normalizeArabic, uniqueStrings } from '../../text/arabic';
import { skillGroup } from '../skills-taxonomy';
import { placeIn, type EducationItem, type ParsedRole } from './experience';
import { cvLines, type Section } from './sections';

/**
 * Reads the CV the way an Applicant Tracking System does and scores it 0–100: can it find the
 * contact details, the standard sections, every role with dates, measurable achievements and the
 * skills keywords? Each check comes with a concrete tip in Arabic. Deterministic and explainable.
 */
export interface AtsInput {
  text: string;
  sections: Section[];
  roles: ParsedRole[];
  education: EducationItem[];
  skills: string[];
  languages: string[];
  certifications: number;
  projects: number;
  hasSummary: boolean;
  titles: string[];
  fileName?: string | undefined;
  /** Text came from reading a scanned image, not from the file's text layer. */
  scanned?: boolean | undefined;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+|00)?\d[\d\s-]{7,}\d/;
const LINKEDIN = /linkedin\.com\/in\/[\w%-]+/i;
const PORTFOLIO = /(https?:\/\/\S+|\b[\w-]+\.(?:netlify\.app|github\.io|vercel\.app|behance\.net|dribbble\.com|wixsite\.com)\b|github\.com\/[\w-]+)/i;

export function contactOf(text: string): AtsReport['contact'] {
  const top = cvLines(text).slice(0, 8);
  const withoutEmail = text.replace(new RegExp(EMAIL.source, 'g'), ' ');
  const phone = PHONE.exec(withoutEmail.replace(/(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}/g, ' '));
  let city: string | null = null;
  for (const line of top) { city = placeIn(line.replace(EMAIL, ' ')); if (city) break; }
  return {
    email: EMAIL.test(text),
    phone: Boolean(phone && phone[0].replace(/\D/g, '').length >= 9),
    city,
    linkedin: LINKEDIN.test(text),
    portfolio: PORTFOLIO.test(withoutEmail.replace(LINKEDIN, ' ')),
  };
}

const EN_VERBS = new Set(['led', 'built', 'ran', 'made', 'wrote', 'won', 'taught', 'grew', 'drove', 'set', 'held', 'sold', 'gave', 'kept', 'met', 'oversaw', 'develop', 'manage', 'lead', 'analyze', 'analyse', 'design', 'build', 'create', 'implement', 'coordinate', 'prepare', 'support', 'monitor', 'conduct', 'deliver', 'train', 'mentor', 'improve', 'maintain', 'handle', 'resolve', 'organize', 'organise', 'plan', 'present', 'track', 'collaborate', 'contribute', 'propose', 'represent', 'perform', 'provide', 'assist', 'ensure', 'achieve', 'increase', 'reduce', 'launch', 'automate', 'optimize', 'serve', 'teach', 'write', 'research', 'evaluate', 'audit', 'review', 'negotiate', 'process', 'operate', 'install', 'repair', 'cook', 'drive', 'care']);
const AR_NOT_VERB = new Set(['في', 'من', 'على', 'علي', 'مع', 'الى', 'إلى', 'هو', 'هي', 'كان', 'كانت', 'عن', 'و']);
export function startsWithAction(line: string): boolean {
  const first = line.trim().split(/\s+/)[0] ?? '';
  if (/[ء-ي]/.test(first)) return first.length >= 3 && !AR_NOT_VERB.has(normalizeArabic(first));
  const word = first.toLowerCase().replace(/[^a-z-]/g, '');
  if (word.length < 3) return false;
  return EN_VERBS.has(word) || (word.endsWith('ed') && word.length > 4) || (word.endsWith('ing') && EN_VERBS.has(word.slice(0, -3))) || (word.endsWith('s') && EN_VERBS.has(word.slice(0, -1)));
}

/** A result with a number: «95%», «60+ tickets», «4 new agents», «٣٠٪» — not a year or a model name like GPT-4. */
export function isQuantified(line: string): boolean {
  const cleaned = line.replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b[A-Za-z]+[-‑]?\d+[A-Za-z]*\b/g, ' ');
  return /\d/.test(cleaned) || /[%٪]/.test(line);
}

/** Text that did not come out cleanly: symbol runs from tables, icon fonts, broken encodings. */
function garbageScore(text: string): number {
  const length = Math.max(1, text.length);
  const junk = (text.match(/[|]{3,}|\(cid:\d+\)|\uFFFD|[\uE000-\uF8FF]/g) ?? []).length;
  const singles = (text.match(/(?:^|\s)[A-Za-z](?=\s)(?:\s[A-Za-z](?=\s)){3,}/g) ?? []).length;
  return (junk * 20 + singles * 40) / length;
}

const rate = (score: number): AtsReport['rating'] => score >= 85 ? 'ممتاز' : score >= 70 ? 'جيد' : score >= 50 ? 'مقبول' : 'ضعيف';
const listAr = (items: string[]) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join('، ')} و${items[items.length - 1]}`;

export function atsReport(input: AtsInput): AtsReport {
  const contact = contactOf(input.text);
  const kinds = new Set(input.sections.map(section => section.kind));
  const words = input.text.split(/\s+/).filter(word => /[A-Za-zء-ي0-9]/.test(word)).length;
  const bullets = input.roles.flatMap(role => role.details);
  const quantified = bullets.filter(isQuantified).length;
  const actionVerbs = bullets.filter(startsWithAction).length;
  const hard = input.skills.filter(skill => skillGroup(skill) !== 'soft');
  const checks: AtsCheck[] = [];
  const check = (id: string, label: string, weight: number, score: number, tip: string) => checks.push({ id, label, weight, score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), tip });

  const missingContact = [!contact.email && 'البريد الإلكتروني', !contact.phone && 'رقم الجوال', !contact.city && 'المدينة'].filter((item): item is string => Boolean(item));
  check('contact', 'بيانات التواصل', 10, (Number(contact.email) * 4 + Number(contact.phone) * 4 + Number(Boolean(contact.city)) * 2) / 10,
    `أضف في أعلى السيرة: ${listAr(missingContact)}.`);
  check('linkedin', 'رابط LinkedIn', 3, contact.linkedin ? 1 : 0, 'أضف رابط حسابك في LinkedIn بجانب بيانات التواصل.');
  check('summary', 'الملخص المهني', 8, input.hasSummary ? 1 : 0, 'أضف ملخصًا مهنيًا من سطرين أو ثلاثة يذكر المسمى الذي تستهدفه وأهم مهاراتك.');

  const standard = [kinds.has('experience') || kinds.has('volunteer'), kinds.has('education'), kinds.has('skills')];
  check('headings', 'عناوين الأقسام المعيارية', 10, standard.filter(Boolean).length / 3,
    'استخدم عناوين أقسام يعرفها نظام ATS: «Experience / الخبرات»، «Education / التعليم»، «Skills / المهارات».');

  const roles = input.roles;
  const dated = roles.filter(role => role.start && (role.end || role.current)).length;
  check('dates', 'تواريخ الخبرات', 12, roles.length ? dated / roles.length : 0,
    roles.length ? 'اكتب تاريخ البداية والنهاية لكل خبرة بصيغة واحدة واضحة، مثل: Feb 2026 – Aug 2026 أو 2022 – الآن.' : 'أضف قسم الخبرات (عمل أو تدريب تعاوني أو تطوع) مع تاريخ كل خبرة.');
  const clear = roles.filter(role => role.title && role.organization).length;
  check('roles', 'وضوح المسمى والجهة', 8, roles.length ? clear / roles.length : 0, 'اكتب لكل خبرة المسمى الوظيفي ثم اسم الجهة في سطر واحد، مثل: «Data Analyst – Almarai».');

  check('quantified', 'إنجازات بالأرقام', 10, bullets.length ? Math.min(1, quantified / bullets.length / 0.4) : 0,
    'أضف أرقامًا لإنجازاتك (نسبة، عدد، مبلغ، مدة)، مثل: «رفعت دقة التقارير ٢٠٪» أو «Resolved 60+ tickets daily».');
  check('verbs', 'أفعال إنجاز', 6, bullets.length ? Math.min(1, actionVerbs / bullets.length / 0.7) : 0,
    'ابدأ كل نقطة بفعل إنجاز: Developed، Analyzed، Led — أو: طوّرت، حلّلت، قدت.');

  check('skills', 'الكلمات المفتاحية للمهارات', 12, Math.min(1, hard.length / 8) * 0.8 + (kinds.has('skills') ? 0.2 : 0),
    'أضف قسم مهارات يذكر الأدوات والبرامج بأسمائها كما تكتبها إعلانات الوظائف (مثل Excel، SQL، Python، Power BI).');
  const fullEducation = input.education.some(item => item.degree && item.institution);
  check('education', 'المؤهل العلمي', 6, fullEducation ? 1 : input.education.length ? 0.5 : 0, 'اذكر المؤهل والتخصص والجامعة وسنة التخرج.');
  check('length', 'طول السيرة', 6, words >= 250 && words <= 900 ? 1 : words >= 150 && words <= 1300 ? 0.5 : 0,
    words < 250 ? 'سيرتك قصيرة؛ أضف تفاصيل خبراتك ومشاريعك وإنجازاتك.' : 'سيرتك طويلة؛ اختصرها إلى صفحة أو صفحتين بأهم ما يخص الوظيفة.');
  const garbage = garbageScore(input.text);
  check('readable', 'قابلية القراءة الآلية', 9, input.scanned ? 0 : garbage < 0.002 ? 1 : garbage < 0.01 ? 0.5 : 0,
    input.scanned ? 'الملف صورة ممسوحة ولا تقرؤه أنظمة ATS. صدّر سيرتك من Word أو Google Docs بصيغة PDF نصية.' : 'تجنّب الجداول والأعمدة والرموز والأيقونات؛ أنظمة ATS تقرأ النص بالترتيب فقط.');
  check('languages', 'اللغات', 3, input.languages.length ? 1 : 0, 'أضف قسم اللغات مع المستوى، مثل: العربية — اللغة الأم، الإنجليزية — متقدم.');
  check('certifications', 'الشهادات والدورات', 3, input.certifications ? 1 : 0, 'أضف الشهادات المهنية والدورات المعتمدة إن وُجدت.');
  const extension = (input.fileName ?? '').toLowerCase().split('.').pop();
  check('file', 'نوع الملف', 4, !extension || extension === 'pdf' || extension === 'docx' ? 1 : 0.5, 'احفظ السيرة بصيغة PDF نصية أو DOCX بدل DOC القديمة.');

  const total = checks.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(checks.reduce((sum, item) => sum + item.weight * item.score, 0) / total * 100);
  const tips = checks.filter(item => item.score < 1).sort((a, b) => (1 - b.score) * b.weight - (1 - a.score) * a.weight).map(item => item.tip).slice(0, 6);

  return {
    score,
    rating: rate(score),
    checks,
    tips,
    keywords: uniqueStrings([...input.titles, ...hard], 20),
    contact,
    sections: [...kinds].filter(kind => kind !== 'header' && kind !== 'other'),
    stats: { words, bullets: bullets.length, quantified, actionVerbs, roles: roles.length },
  };
}

import { normalizeArabic, uniqueStrings } from '../../text/arabic';

/**
 * Reads work experience the way an ATS does: each role with its title, organisation, location,
 * start/end dates, kind (job, internship, volunteering) and achievements. Durations are computed
 * from the dates (never guessed) and written in Arabic.
 */
export type RoleKind = 'job' | 'internship' | 'volunteer';
export interface ExperienceItem {
  title: string;
  organization: string;
  location: string;
  /** "YYYY" or "YYYY-MM" (Gregorian). */
  start: string | null;
  end: string | null;
  current: boolean;
  highlights: string[];
  kind?: RoleKind;
}
/** A role with every line written under it (achievements), used for ATS checks and skill mining. */
export interface ParsedRole extends ExperienceItem { details: string[]; kind: RoleKind }
interface YearMonth { year: number; month: number | null }

const MONTHS: Record<string, number> = {
  يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, مايو: 5, يونيو: 6, يونيه: 6, يوليو: 7, يوليه: 7, اغسطس: 8, سبتمبر: 9, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
  'كانون الثاني': 1, شباط: 2, اذار: 3, نيسان: 4, ايار: 5, حزيران: 6, تموز: 7, اب: 8, ايلول: 9, 'تشرين الاول': 10, 'تشرين الثاني': 11, 'كانون الاول': 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
// Matched on the original text (only digits are normalised), so the range can be cut out exactly.
const MONTH_ALT = 'يناير|فبراير|مارس|أبريل|ابريل|إبريل|مايو|يونيو|يونيه|يوليو|يوليه|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|كانون الثاني|شباط|آذار|اذار|نيسان|أيار|ايار|حزيران|تموز|آب|أيلول|ايلول|تشرين الأول|تشرين الاول|تشرين الثاني|كانون الأول|كانون الاول|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
const PRESENT = 'حتى الآن|حتى الان|إلى الآن|الى الآن|الى الان|الآن|الان|حالياً|حاليًا|حاليا|للآن|لا يزال|مستمر|present|currently|current|now|today|to date|till date|ongoing';
const DATE = String.raw`(?:(?:${MONTH_ALT})\.?,?\s+\d{4}|\d{1,2}\s*[/.-]\s*\d{4}|\d{4}\s*[/.-]\s*\d{1,2}(?!\d)|1[34]\d{2}\s*هـ?|(?:19|20)\d{2})`;
const RANGE = new RegExp(String.raw`(?:(?:من|from)\s+)?(${DATE})\s*(?:-|–|—|~|to|until|till|إلى|الى|حتى)\s*(${DATE}|${PRESENT})|(?:منذ|since)\s+(${DATE})`, 'i');
const toAsciiDigits = (value: string) => value.replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

function parseDate(raw: string): YearMonth | null {
  const text = normalizeArabic(raw).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const hijri = /^(1[34]\d{2})\s*ه/.exec(text);
  if (hijri) return { year: Math.round(Number(hijri[1]) * 0.970229 + 621.5643), month: null };
  const named = new RegExp(`^(${MONTH_ALT})\\s+(\\d{4})$`, 'i').exec(text);
  if (named && MONTHS[named[1]!.toLowerCase()]) return { year: Number(named[2]), month: MONTHS[named[1]!.toLowerCase()] ?? null };
  const monthYear = /^(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(text) ?? /^(\d{1,2})\s+(\d{4})$/.exec(text);
  if (monthYear) return { year: Number(monthYear[2]), month: Math.min(12, Math.max(1, Number(monthYear[1]))) };
  const yearMonth = /^(\d{4})\s*[/.-]\s*(\d{1,2})$/.exec(text);
  if (yearMonth) return { year: Number(yearMonth[1]), month: Math.min(12, Math.max(1, Number(yearMonth[2]))) };
  const year = /^((?:19|20)\d{2})$/.exec(text);
  return year ? { year: Number(year[1]), month: null } : null;
}

const serialize = (value: YearMonth | null) => value ? (value.month ? `${value.year}-${String(value.month).padStart(2, '0')}` : String(value.year)) : null;
function deserialize(value: string | null): YearMonth | null {
  if (!value) return null;
  const [year, month] = value.split('-').map(Number);
  return year ? { year, month: month || null } : null;
}

export interface DateRange { start: string | null; end: string | null; current: boolean; text: string }
export function findDateRange(line: string): DateRange | null {
  const range = RANGE.exec(toAsciiDigits(line));
  if (range) {
    if (range[3]) return { start: serialize(parseDate(range[3])), end: null, current: true, text: range[0] };
    const start = parseDate(range[1]!);
    const end = parseDate(range[2]!);
    if (!start) return null;
    return { start: serialize(start), end: serialize(end), current: !end, text: range[0] };
  }
  return null;
}

/** Months between two dates (inclusive of the start month); null when only one year is known. */
export function monthsOf(item: Pick<ExperienceItem, 'start' | 'end' | 'current'>, now = new Date()): number | null {
  const start = deserialize(item.start);
  if (!start) return null;
  const end = item.current ? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 } : deserialize(item.end);
  if (!end) return null;
  if (start.month && end.month) return Math.max(1, (end.year - start.year) * 12 + (end.month - start.month) + 1);
  const years = end.year - start.year;
  return years > 0 ? years * 12 : null;
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const arDigits = (value: string | number) => String(value).replace(/\d/g, digit => AR_DIGITS[Number(digit)]!);

function yearsAr(years: number): string {
  if (years === 1) return 'سنة';
  if (years === 2) return 'سنتان';
  return years <= 10 ? `${arDigits(years)} سنوات` : `${arDigits(years)} سنة`;
}
function monthsAr(months: number): string {
  if (months === 1) return 'شهر';
  if (months === 2) return 'شهران';
  return months <= 10 ? `${arDigits(months)} أشهر` : `${arDigits(months)} شهرًا`;
}
export function durationAr(months: number | null): string {
  if (!months || months < 1) return '';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return monthsAr(rest);
  return rest ? `${yearsAr(years)} و${monthsAr(rest)}` : yearsAr(years);
}

const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function dateAr(value: string | null): string {
  const parsed = deserialize(value);
  if (!parsed) return '';
  return parsed.month ? `${MONTH_NAMES_AR[parsed.month - 1]} ${arDigits(parsed.year)}` : arDigits(parsed.year);
}
/** «مارس ٢٠٢٣ – الآن»: kept in the role details for whoever needs the exact dates. */
export function periodAr(item: Pick<ExperienceItem, 'start' | 'end' | 'current'>): string {
  const start = dateAr(item.start);
  if (!start) return '';
  if (item.current) return `${start} – الآن`;
  const end = dateAr(item.end);
  return end && end !== start ? `${start} – ${end}` : start;
}

const INTERN = /(trainee|intern\b|internship|co-?op\b|cooperative|apprentice|متدرب|تدريب تعاوني|تدريب ميداني|تمهير|summer training)/i;

/**
 * One short line per role, like the dashboard's design: «المسمى · الجهة · المدة» — no raw dates.
 * e.g. «محلل بيانات · شركة المراعي · ٤ سنوات», «Consultant · IT Committee · ٣ سنوات · تطوعي».
 */
export function formatExperience(item: ExperienceItem, now = new Date()): string {
  const parts = [item.title, item.organization, durationAr(monthsOf(item, now))];
  if (item.kind === 'volunteer') parts.push('تطوعي');
  else if (item.kind === 'internship' && !INTERN.test(normalizeArabic(item.title))) parts.push('تدريب');
  return parts.filter(Boolean).join(' · ');
}

/** Total experience without double-counting overlapping roles, in years (one decimal). */
export function totalYears(items: Pick<ExperienceItem, 'start' | 'end' | 'current'>[], now = new Date()): number | null {
  const intervals: [number, number][] = [];
  for (const item of items) {
    const start = deserialize(item.start);
    const months = monthsOf(item, now);
    if (!start || !months) continue;
    const from = start.year * 12 + (start.month ?? 1) - 1;
    intervals.push([from, from + months]);
  }
  if (!intervals.length) return null;
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0; let [curStart, curEnd] = intervals[0]!;
  for (const [from, to] of intervals.slice(1)) {
    if (from <= curEnd) curEnd = Math.max(curEnd, to);
    else { total += curEnd - curStart; [curStart, curEnd] = [from, to]; }
  }
  total += curEnd - curStart;
  return Math.round(total / 12 * 10) / 10;
}

/* ───────────── Recognising the parts of a role ───────────── */

export const BULLET = /^[•·▪●◦○■□➢➤►✓✔✗*\-–]\s*/;
const SENTENCE_END = /[.!?؟]$/;
const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'in', 'at', 'on', 'to', 'with', 'a', 'an', 'de', 'by', 'from', 'via', 'as']);

// Head nouns: what a phrase *is*. English heads come last («Core team member»), Arabic heads first («شركة المراعي»).
const TITLE_HEADS_EN = new Set(['analyst', 'designer', 'developer', 'engineer', 'accountant', 'specialist', 'assistant', 'manager', 'technician', 'teacher', 'trainer', 'clerk', 'officer', 'coordinator', 'representative', 'consultant', 'agent', 'operator', 'supervisor', 'intern', 'trainee', 'nurse', 'doctor', 'physician', 'pharmacist', 'lead', 'head', 'director', 'administrator', 'executive', 'associate', 'programmer', 'architect', 'cashier', 'receptionist', 'secretary', 'member', 'chair', 'chairman', 'chairperson', 'president', 'volunteer', 'leader', 'ambassador', 'founder', 'co-founder', 'mentor', 'tutor', 'instructor', 'researcher', 'scientist', 'writer', 'editor', 'translator', 'interpreter', 'advisor', 'adviser', 'planner', 'auditor', 'controller', 'buyer', 'driver', 'chef', 'cook', 'barista', 'waiter', 'guard', 'worker', 'apprentice', 'fellow', 'partner', 'owner', 'freelancer', 'tester', 'strategist', 'marketer', 'recruiter', 'therapist', 'dentist', 'pharmacist', 'paralegal', 'lawyer', 'secretary-general', 'organizer', 'organiser', 'moderator', 'captain', 'treasurer', 'delegate']);
const ORG_HEADS_EN = new Set(['company', 'corp', 'corporation', 'bank', 'ministry', 'authority', 'university', 'college', 'hospital', 'clinic', 'center', 'centre', 'group', 'inc', 'ltd', 'llc', 'co', 'foundation', 'association', 'agency', 'school', 'hotel', 'factory', 'store', 'club', 'committee', 'team', 'council', 'society', 'institute', 'academy', 'organization', 'organisation', 'department', 'office', 'program', 'programme', 'initiative', 'lab', 'laboratory', 'studio', 'firm', 'bureau', 'commission', 'fund', 'network', 'community', 'union', 'federation', 'chamber', 'holding', 'holdings', 'solutions', 'services', 'systems', 'technologies', 'technology', 'consulting', 'partners', 'bookstore', 'pharmacy', 'airlines', 'airways', 'telecom', 'municipality', 'court', 'embassy', 'platform', 'project', 'museum', 'library', 'hub']);
const TITLE_HEADS_AR = ['محلل', 'مصمم', 'مطور', 'مبرمج', 'مهندس', 'محاسب', 'اخصائي', 'مساعد', 'مدير', 'موظف', 'فني', 'معلم', 'مدرس', 'مدرب', 'سكرتير', 'كاشير', 'مندوب', 'منسق', 'مشرف', 'ممثل', 'باحث', 'كاتب', 'مدخل', 'متدرب', 'ممرض', 'طبيب', 'صيدلي', 'مستشار', 'رئيس', 'قائد', 'امين', 'مراقب', 'مسؤول', 'مسئول', 'خبير', 'استشاري', 'عضو', 'متطوع', 'نائب', 'مؤسس', 'مرشد', 'مترجم', 'محرر', 'سفير', 'مدقق', 'مصور', 'طاه', 'سائق', 'حارس', 'عامل', 'بائع', 'مستقبل', 'منظم'];
const ORG_HEADS_AR = ['شركه', 'مؤسسه', 'بنك', 'مصرف', 'وزاره', 'هيئه', 'جامعه', 'كليه', 'معهد', 'مستشفي', 'مستوصف', 'مركز', 'مجموعه', 'جمعيه', 'مكتب', 'مدرسه', 'امانه', 'بلديه', 'اداره', 'مجمع', 'مصنع', 'متجر', 'فندق', 'مطعم', 'نادي', 'لجنه', 'فريق', 'مجلس', 'برنامج', 'مبادره', 'اكاديميه', 'صندوق', 'منصه', 'مكتبه', 'صيدليه', 'عياده', 'محكمه', 'سفاره', 'قسم', 'وكاله', 'مختبر', 'معرض', 'مشروع'];

const TITLE_ANY = /(محلل|مصمم|مطور|مبرمج|مهندس|محاسب|اخصائي|مساعد|مدير|موظف|فني|معلم|مدرب|سكرتير|كاشير|مندوب|منسق|مشرف|ممثل|باحث|كاتب|مدخل|متدرب|ممرض|طبيب|صيدلي|مستشار|رئيس|قائد|امين|مراقب|مسؤول|خبير|استشاري|analyst|designer|developer|engineer|accountant|specialist|assistant|manager|technician|teacher|trainer|clerk|officer|coordinator|representative|consultant|agent|operator|supervisor|intern|trainee|nurse|doctor|pharmacist|director|administrator|executive|associate|programmer|architect|cashier|receptionist|secretary)/i;
const ORG_ANY = /(شركه|مؤسسه|بنك|مصرف|وزاره|هيئه|جامعه|كليه|معهد|مستشفي|مستوصف|مركز|مجموعه|جمعيه|مكتب|مدرسه|امانه|بلديه|اداره|مجمع|مصنع|متجر|فندق|مطعم|\bcompany\b|\bcorp|\bbank\b|\bministry\b|\bauthority\b|\buniversity\b|\bcollege\b|\bhospital\b|\bclinic\b|\bcent(er|re)\b|\bgroup\b|\binc\b|\bltd\b|\bllc\b|\bfoundation\b|\bassociation\b|\bagency\b|\bschool\b|\bhotel\b|\bclub\b|\bcommittee\b|\binstitute\b|\bacademy\b)/i;

const PLACES = new Set([
  'الرياض', 'جده', 'الدمام', 'مكه', 'مكه المكرمه', 'المدينه', 'المدينه المنوره', 'الخبر', 'الظهران', 'الطائف', 'تبوك', 'ابها', 'القصيم', 'بريده', 'عنيزه', 'حائل', 'جازان', 'جيزان', 'نجران', 'الاحساء', 'الهفوف', 'الجبيل', 'ينبع', 'الباحه', 'عرعر', 'سكاكا', 'الجوف', 'خميس مشيط', 'القطيف', 'حفر الباطن', 'الخرج', 'المنطقه الشرقيه', 'نيوم', 'العلا',
  'riyadh', 'jeddah', 'jiddah', 'dammam', 'makkah', 'mecca', 'madinah', 'medina', 'al madinah', 'khobar', 'al khobar', 'alkhobar', 'dhahran', 'taif', 'tabuk', 'abha', 'qassim', 'al qassim', 'buraidah', 'buraydah', 'hail', 'jazan', 'jizan', 'najran', 'al ahsa', 'al-ahsa', 'ahsa', 'hofuf', 'jubail', 'yanbu', 'al baha', 'arar', 'sakaka', 'khamis mushait', 'qatif', 'hafar al-batin', 'al kharj', 'eastern province', 'neom', 'alula',
  'saudi arabia', 'kingdom of saudi arabia', 'ksa', 'sa', 'السعوديه', 'المملكه العربيه السعوديه', 'المملكه',
  'uae', 'united arab emirates', 'الامارات', 'dubai', 'دبي', 'abu dhabi', 'ابوظبي', 'qatar', 'قطر', 'doha', 'الدوحه', 'kuwait', 'الكويت', 'bahrain', 'البحرين', 'manama', 'المنامه', 'oman', 'عمان', 'muscat', 'مسقط', 'egypt', 'مصر', 'cairo', 'القاهره', 'jordan', 'الاردن', 'amman', 'usa', 'united states', 'uk', 'united kingdom', 'london', 'canada', 'australia', 'malaysia', 'india', 'pakistan',
  'remote', 'hybrid', 'on-site', 'onsite', 'عن بعد', 'هجين', 'حضوري',
]);

/** «Saudi Arabia, Riyadh» / «الرياض» / «Remote»: a line or piece made only of places. */
export function isPlace(piece: string): boolean {
  // Split before normalising: normalizeArabic() removes commas, dashes and brackets.
  const parts = piece.split(/[,،|/–—()·]|\s-\s/).map(part => normalizeArabic(part).replace(/\.+$/, '').trim()).filter(Boolean);
  return parts.length > 0 && parts.every(part => PLACES.has(part));
}

const NOT_CITY = new Set(['saudi arabia', 'kingdom of saudi arabia', 'ksa', 'sa', 'السعوديه', 'المملكه العربيه السعوديه', 'المملكه', 'remote', 'hybrid', 'on-site', 'onsite', 'عن بعد', 'هجين', 'حضوري', 'uae', 'usa', 'uk']);
const CITIES = [...PLACES].filter(place => !NOT_CITY.has(place)).sort((a, b) => b.length - a.length);
const titleCase = (value: string) => value.replace(/(^|\s)([a-z])/g, (_all, space: string, letter: string) => `${space}${letter.toUpperCase()}`);

/** The city (or country) named in a line: a separated piece first, else a known city anywhere in it. */
export function placeIn(line: string): string | null {
  for (const part of line.split(/[,،|/–—·]|\s-\s/).map(item => item.trim()).filter(Boolean)) if (isPlace(part)) return part;
  const padded = ` ${normalizeArabic(line)} `;
  const city = CITIES.find(place => padded.includes(` ${place} `));
  return city ? titleCase(city) : null;
}

function titleCaseRatio(line: string): number {
  const words = line.split(/\s+/).map(word => word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')).filter(word => /[A-Za-z]/.test(word) && !SMALL_WORDS.has(word.toLowerCase()));
  if (!words.length) return 0;
  return words.filter(word => /^[A-Z]/.test(word)).length / words.length;
}

/** What a piece names: a job title, an organisation, a place, or unknown — read from its head noun. */
export function pieceKind(piece: string): 'title' | 'org' | 'place' | null {
  if (isPlace(piece)) return 'place';
  // Brackets go before normalising («Authority (NCA)» → «authority»), since normalizeArabic() drops the brackets only.
  const key = normalizeArabic(piece.replace(/\([^)]*\)/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!key) return null;
  if (/[a-z]/.test(key) && !/[ء-ي]/.test(key)) {
    const core = key.split(/\s+(?:of|for|at|in|and|&)\s+|\s[-–—|]\s/)[0]!.trim();
    const words = core.split(/[\s/]+/).filter(Boolean);
    const head = words[words.length - 1] ?? '';
    const first = words[0] ?? '';
    if (TITLE_HEADS_EN.has(head)) return 'title';
    if (ORG_HEADS_EN.has(head) || ORG_HEADS_EN.has(first)) return 'org';
    // «Google Developer Group Jeddah»: an organisation word anywhere wins over a title word inside a name.
    if (words.some(word => ORG_HEADS_EN.has(word))) return 'org';
    if (words.some(word => TITLE_HEADS_EN.has(word))) return 'title';
    return null;
  }
  const first = key.split(/\s+/)[0] ?? '';
  const stem = first.replace(/^(ال|و)/, '').replace(/(ه|ات|ين|ون)$/, '');
  if (ORG_HEADS_AR.some(word => first === word || first === `ال${word}`) || first === 'مديريه') return 'org';
  if (TITLE_HEADS_AR.some(word => stem === word || first === word || stem.startsWith(word))) return 'title';
  if (ORG_HEADS_AR.includes(stem)) return 'org';
  if (ORG_ANY.test(key)) return 'org';
  if (TITLE_ANY.test(key)) return 'title';
  return null;
}

function cleanPart(part: string): string {
  let value = part.replace(BULLET, '').replace(/^[\s\-–—|·:،,]+|[\s\-–—|·:،,]+$/g, '').replace(/\s+/g, ' ').trim();
  // Drop only unbalanced brackets: keep «Call Center Agent (chat)».
  if (value.startsWith('(') && !value.includes(')')) value = value.slice(1).trim();
  if (value.endsWith(')') && !value.includes('(')) value = value.slice(0, -1).trim();
  if ((value.match(/\(/g) ?? []).length > (value.match(/\)/g) ?? []).length) value = `${value})`;
  return value;
}

const SPLIT_HEADER = /\s+[-–—|·•]\s+|\s*[|·•]\s*|\s+(?:at|@|لدى|لدي)\s+|\s+في\s+(?=(?:شركة|شركه|مؤسسة|مؤسسه|بنك|وزارة|وزاره|هيئة|هيئه|جامعة|جامعه|مستشفى|مستشفي|مركز|مجموعة|مجموعه|جمعية|جمعيه))|\s*،\s*|,\s*(?![^(]*\))/i;

const headerPieces = (part: string) => part.split(SPLIT_HEADER).map(cleanPart)
  .filter(piece => piece.length >= 2 && piece.length <= 90 && !/^\d+$/.test(piece) && !/^(خبره|خبرة|experience)$/i.test(normalizeArabic(piece)));

/**
 * Splits «Title - Organisation, Program» / «محلل بيانات - شركة المراعي - الرياض» into title, organisation, location.
 * With two header lines («Team Leader, Customer Care» / «Almarai, Riyadh») the organisation comes from the line under the title.
 */
export function splitHeader(parts: string[]): Pick<ExperienceItem, 'title' | 'organization' | 'location'> {
  const lines = parts.map(headerPieces).filter(line => line.length);
  const titleLine = lines.findIndex(line => line.some(piece => pieceKind(piece) === 'title'));
  if (lines.length >= 2 && titleLine >= 0 && titleLine < lines.length - 1) {
    const own = lines[titleLine]!;
    const titleAt = own.findIndex(piece => pieceKind(piece) === 'title');
    const after = own.slice(titleAt + 1).filter(piece => pieceKind(piece) !== 'place');
    const below = lines.slice(titleLine + 1).flat();
    const belowOrg = below.find(piece => pieceKind(piece) !== 'place' && pieceKind(piece) !== 'title');
    // Organisation on the next line: what follows the title on its own line qualifies the title («Customer Care»).
    const organization = belowOrg ?? after.find(piece => pieceKind(piece) === 'org') ?? after[0] ?? '';
    const qualifiers = belowOrg ? after.filter(piece => pieceKind(piece) !== 'org') : [];
    const location = [...below, ...own].find(piece => pieceKind(piece) === 'place') ?? '';
    return { title: [own[titleAt]!, ...qualifiers].join('، '), organization, location };
  }
  const pieces = lines.flat();
  const kinds = pieces.map(pieceKind);
  let titleAt = kinds.indexOf('title');
  let orgAt = kinds.findIndex((kind, index) => kind === 'org' && index !== titleAt);
  const placeAt = kinds.indexOf('place');
  const free = pieces.map((_, index) => index).filter(index => kinds[index] === null);
  if (titleAt < 0) titleAt = free.shift() ?? -1;
  else if (orgAt < 0) {
    // «Consultant, IT Committee, …»: the organisation is the next unknown piece after the title.
    const next = free.find(index => index > titleAt);
    if (next !== undefined) { orgAt = next; free.splice(free.indexOf(next), 1); }
  }
  if (orgAt < 0) orgAt = free.find(index => index !== titleAt) ?? -1;
  // Extra organisation pieces after the organisation stay with it («IT Committee، Ajyalna Alwaidah»).
  const extras = orgAt < 0 ? [] : pieces.map((_, index) => index).filter(index => index > orgAt && index !== titleAt && index !== placeAt && (kinds[index] === 'org' || kinds[index] === null) && pieces[index]!.split(' ').length <= 6);
  return {
    title: titleAt >= 0 ? pieces[titleAt]! : '',
    organization: orgAt >= 0 ? [pieces[orgAt]!, ...extras.map(index => pieces[index]!)].join('، ') : '',
    location: placeAt >= 0 ? pieces[placeAt]! : '',
  };
}

/** «مستشفى الملك فهد بالدمام في رعاية المرضى» → organisation + the description that followed it. */
function separateDescription(organization: string): { organization: string; description: string } {
  if (organization.split(' ').length <= 5) return { organization, description: '' };
  const cut = /\s(?:في|حيث|where|working on|responsible for)\s/i.exec(organization);
  if (!cut || cut.index < 4) return { organization, description: '' };
  return { organization: organization.slice(0, cut.index).trim(), description: organization.slice(cut.index).replace(/^\s*(?:في|حيث)\s*/, '').trim() };
}

const DEGREE = /(بكالوريوس|بكالريوس|ماجستير|دكتوراه|دبلوم|ثانوي|ثانويه|bachelor|master|phd|diploma|degree|b\.?sc|m\.?sc|\bba\b|\bma\b|mba|high school)/i;

/** A role header line: short, not a sentence, mostly Title Case (English) or led by a title/organisation word (Arabic). */
function looksLikeHeader(line: string): boolean {
  if (BULLET.test(line) || line.length < 3 || line.length > 130 || SENTENCE_END.test(line) || /^[a-z]/.test(line)) return false;
  const words = line.split(/\s+/).length;
  if (/[A-Za-z]/.test(line) && !/[ء-ي]/.test(line)) return words <= 16 && titleCaseRatio(line) >= 0.6;
  if (words > 14) return false;
  const first = line.split(SPLIT_HEADER)[0] ?? line;
  const kind = pieceKind(first);
  return kind === 'title' || kind === 'org' || (/\s[-–—|]\s|،/.test(line) && (TITLE_ANY.test(normalizeArabic(line)) || ORG_ANY.test(normalizeArabic(line))));
}

/** A comma list of short items («BLS, ACLS, مكافحة العدوى») — not an achievement. */
const isList = (line: string) => {
  const items = line.split(/[,،;|]/).map(item => item.trim()).filter(Boolean);
  return items.length >= 3 && items.every(item => item.split(/\s+/).length <= 4);
};

type LineKind = 'date' | 'inline' | 'place' | 'bullet' | 'continuation' | 'header' | 'text';
function classify(line: string, previous: { kind: LineKind; line: string } | null): { kind: LineKind; range?: DateRange } {
  const bullet = BULLET.test(line);
  const range = findDateRange(line);
  if (range && !(bullet && previous)) {
    const rest = toAsciiDigits(line).replace(range.text, ' ').replace(BULLET, '');
    const meaningful = rest.split(/[,،|·()\-–—:]/).map(part => part.trim()).filter(part => part && !isPlace(part) && /[A-Za-zء-ي]{2}/.test(part));
    return { kind: meaningful.length ? 'inline' : 'date', range };
  }
  if (bullet) return { kind: 'bullet' };
  if (isPlace(line) && line.length <= 60) return { kind: 'place' };
  // Lower-case start: a wrapped sentence — unless it is a short organisation line right under a title («stc, Riyadh»).
  if (/^[a-z]/.test(line)) return previous?.kind === 'header' && line.split(/\s+/).length <= 6 && !SENTENCE_END.test(line) ? { kind: 'header' } : { kind: 'continuation' };
  if (previous && ['bullet', 'text', 'continuation'].includes(previous.kind) && !SENTENCE_END.test(previous.line) && !looksLikeHeader(line)) return { kind: 'continuation' };
  if (looksLikeHeader(line)) return { kind: 'header' };
  return { kind: 'text' };
}

interface Block { header: string[]; range: DateRange | null; location: string; details: string[] }

function roleKindOf(title: string, organization: string, sectionKind: RoleKind): RoleKind {
  if (sectionKind === 'volunteer') return 'volunteer';
  const key = normalizeArabic(`${title} ${organization}`);
  if (/(volunteer|متطوع|تطوعي)/i.test(key)) return 'volunteer';
  return INTERN.test(key) ? 'internship' : sectionKind;
}

/**
 * Parses an experience section (or the whole CV when it has none) into roles. Works whatever the
 * layout: one-line roles («محلل بيانات - شركة المراعي - 2022 - الآن: …»), title/organisation/date on
 * separate lines, the date before or after the header, or between the achievements (two-column PDFs).
 */
export function parseRoles(lines: string[], sectionKind: RoleKind = 'job'): ParsedRole[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let loose: string[] = [];
  let previous: { kind: LineKind; line: string } | null = null;
  const start = (header: string[], range: DateRange | null) => { current = { header, range, location: '', details: [] }; blocks.push(current); loose = []; return current; };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const { kind, range } = classify(line, previous);
    const block = current as Block | null;
    switch (kind) {
      case 'inline': {
        // «العنوان - الجهة - 2022 - الآن: الوصف» or «STC Solutions | Mar 2023 – Present».
        const withoutDate = toAsciiDigits(line).replace(BULLET, '').replace(range!.text, ' ');
        const [head = '', ...descParts] = withoutDate.split(/[:：]\s+/);
        const description = descParts.join(': ').trim();
        if (block && !block.range && !block.details.length && block.header.length) {
          block.header.push(head); block.range = range!;
          if (description) block.details.push(description);
        } else {
          const created = start([...(block ? [] : loose.slice(-2)), head], range!);
          if (description) created.details.push(description);
        }
        break;
      }
      case 'date':
        if (block && !block.range) { block.range = range!; block.location ||= placeIn(line) ?? ''; }
        else start(block ? [] : loose.slice(-2), range!).location = placeIn(line) ?? '';
        break;
      case 'place':
        if (block && !block.location) block.location = line;
        break;
      case 'header': {
        // A second header line joins the role («STC Solutions | Riyadh» under its title) unless it is a
        // complete «Title - Organisation» line that follows an already dated role.
        const fullRole = pieceKind(line.split(SPLIT_HEADER)[0] ?? line) === 'title' && SPLIT_HEADER.test(line);
        if (block && !block.details.length && block.header.length < 2 && !(block.header.length && block.range && fullRole)) block.header.push(line);
        else start([line], null);
        break;
      }
      case 'bullet':
        if (block) block.details.push(cleanPart(line));
        break;
      case 'continuation':
        if (block?.details.length) block.details[block.details.length - 1] = `${block.details[block.details.length - 1]} ${line}`;
        else if (block?.header.length) block.header[block.header.length - 1] = `${block.header[block.header.length - 1]} ${line}`;
        break;
      case 'text':
        if (block) { if (!isList(line)) block.details.push(line); }
        else if (line.length <= 90) { loose.push(line); if (loose.length > 3) loose.shift(); }
        break;
    }
    previous = { kind, line };
  }

  return blocks.map(block => {
    const header = splitHeader(block.header);
    const split = separateDescription(header.organization);
    const details = uniqueStrings([split.description, ...block.details].map(cleanPart).filter(detail => detail.length >= 6).map(detail => detail.replace(/\.+$/, '')), 12);
    const kind = roleKindOf(header.title, split.organization, sectionKind);
    return {
      title: header.title, organization: split.organization, location: header.location || block.location,
      start: block.range?.start ?? null, end: block.range?.end ?? null, current: block.range?.current ?? false,
      highlights: details.slice(0, 3).map(detail => detail.length > 130 ? `${detail.slice(0, 127).replace(/\s\S*$/, '')}…` : detail),
      details, kind,
    };
  }).filter(role => (role.start && (role.title || role.organization)) || (role.title && role.organization && pieceKind(role.title) === 'title'));
}

/** Roles without the internal details (kept for callers that only need what is shown). */
export function parseExperience(lines: string[], sectionKind: RoleKind = 'job'): ExperienceItem[] {
  return parseRoles(lines, sectionKind).map(({ details: _details, ...role }) => role);
}

/* ───────────── Education ───────────── */

export interface EducationItem { degree: string; institution: string; year: string | null; gpa?: string | null; current?: boolean }
const INSTITUTION = /(جامعه|كليه|معهد|مدرسه|ثانويه|اكاديميه|university|college|institute|school|academy|polytechnic)/i;
const GPA = /(?:\b(?:c?gpa)\b|المعدل(?: التراكمي)?|معدل)\s*(?:of|:|=)?\s*(\d+(?:[.,]\d+)?)(?:\s*(?:\/|out of|من)\s*(\d+(?:[.,]\d+)?))?/i;

export function parseEducation(lines: string[]): EducationItem[] {
  const out: EducationItem[] = [];
  let current: EducationItem | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const key = normalizeArabic(line);
    const bullet = BULLET.test(line);
    const gpa = GPA.exec(toAsciiDigits(line));
    const range = findDateRange(line);
    const years = [...toAsciiDigits(line).matchAll(/(?:19|20)\d{2}/g)].map(match => match[0]);
    const text = toAsciiDigits(line).replace(range?.text ?? '§', ' ').replace(GPA, ' ').replace(/\(?\s*(?:19|20)\d{2}\s*(?:[-–—]\s*(?:(?:19|20)\d{2}|الآن|present))?\s*\)?/gi, ' ');
    const parts = text.split(/\s+[-–—|·•]\s+|\s*[|·•،,]\s*|\s+(?:from|at|من)\s+(?=(?:جامعة|جامعه|كلية|كليه|معهد|university|college|institute))/i).map(cleanPart).filter(part => part.length >= 2);
    const degree = !bullet || DEGREE.test(key) ? parts.find(part => DEGREE.test(normalizeArabic(part))) ?? '' : '';
    const institution = bullet ? '' : parts.find(part => part !== degree && INSTITUTION.test(normalizeArabic(part))) ?? '';
    if (degree) {
      current = { degree, institution, year: range ? (range.current ? null : (range.end ?? range.start)?.slice(0, 4) ?? null) : years.at(-1) ?? null, gpa: gpa ? (gpa[2] ? `${gpa[1]}/${gpa[2]}` : gpa[1]!) : null, current: range?.current ?? false };
      out.push(current);
      continue;
    }
    if (institution && current && !current.institution) { current.institution = institution; current.year ??= years.at(-1) ?? null; }
    else if (institution) { current = { degree: '', institution, year: years.at(-1) ?? null, gpa: null }; out.push(current); }
    if (current && gpa && !current.gpa) current.gpa = gpa[2] ? `${gpa[1]}/${gpa[2]}` : gpa[1]!;
    if (current && range && !institution) { current.current = range.current; current.year = range.current ? null : (range.end ?? range.start)?.slice(0, 4) ?? current.year; }
    else if (current && !range && !institution && !bullet && years.length && !current.year) current.year = years.at(-1)!;
  }
  return out.filter(item => item.degree || item.institution).slice(0, 5);
}

export const formatEducation = (item: EducationItem) => [
  item.degree, item.institution,
  item.current ? 'حتى الآن' : item.year ? arDigits(item.year) : '',
  item.gpa ? `المعدل ${item.gpa}` : '',
].filter(Boolean).join(' · ');

import { normalizeArabic, uniqueStrings } from '../../text/arabic';

/**
 * Reads work experience the way a recruiter does: each role with its organisation, location,
 * start/end dates and highlights; durations are computed (never guessed) and written in Arabic.
 */
export interface ExperienceItem {
  title: string;
  organization: string;
  location: string;
  /** "YYYY" or "YYYY-MM" (Gregorian). */
  start: string | null;
  end: string | null;
  current: boolean;
  highlights: string[];
}
interface YearMonth { year: number; month: number | null }

const MONTHS: Record<string, number> = {
  يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, مايو: 5, يونيو: 6, يوليو: 7, اغسطس: 8, سبتمبر: 9, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
  'كانون الثاني': 1, شباط: 2, اذار: 3, نيسان: 4, ايار: 5, حزيران: 6, تموز: 7, اب: 8, ايلول: 9, 'تشرين الاول': 10, 'تشرين الثاني': 11, 'كانون الاول': 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
// Matched on the original text (only digits are normalised), so the range can be cut out exactly.
const MONTH_ALT = 'يناير|فبراير|مارس|أبريل|ابريل|إبريل|مايو|يونيو|يونيه|يوليو|يوليه|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|كانون الثاني|شباط|آذار|اذار|نيسان|أيار|ايار|حزيران|تموز|آب|أيلول|ايلول|تشرين الأول|تشرين الاول|تشرين الثاني|كانون الأول|كانون الاول|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
const PRESENT = 'حتى الآن|حتى الان|إلى الآن|الى الآن|الى الان|الآن|الان|حالياً|حاليًا|حاليا|للآن|لا يزال|مستمر|present|currently|current|now|today|to date|till date|ongoing';
const DATE = String.raw`(?:(?:${MONTH_ALT})\.?\s+\d{4}|\d{1,2}\s*[/.-]\s*\d{4}|\d{4}\s*[/.-]\s*\d{1,2}(?!\d)|1[34]\d{2}\s*هـ?|(?:19|20)\d{2})`;
const RANGE = new RegExp(String.raw`(?:(?:من|from)\s+)?(${DATE})\s*(?:-|–|—|~|to|until|till|إلى|الى|حتى)\s*(${DATE}|${PRESENT})|(?:منذ|since)\s+(${DATE})`, 'i');
const toAsciiDigits = (value: string) => value.replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

const ORG = /(شركه|مؤسسه|بنك|مصرف|وزاره|هيئه|جامعه|كليه|معهد|مستشفي|مستوصف|مركز|مجموعه|جمعيه|مكتب|مدرسه|امانه|بلديه|ادارة|اداره|مجمع|مصنع|متجر|فندق|مطعم|company|corp|corporation|bank|ministry|authority|university|college|hospital|clinic|center|centre|group|inc|ltd|llc|co\b|est\b|foundation|association|agency|school|hotel|factory|store)/i;
const TITLE = /(محلل|مصمم|مطور|مبرمج|مهندس|محاسب|اخصائي|مساعد|مدير|موظف|فني|معلم|مدرب|سكرتير|كاشير|مندوب|منسق|مشرف|ممثل|باحث|كاتب|مدخل|متدرب|ممرض|طبيب|صيدلي|مستشار|رئيس|قائد|امين|مراقب|مسؤول|خبير|استشاري|analyst|designer|developer|engineer|accountant|specialist|assistant|manager|technician|teacher|trainer|clerk|officer|coordinator|representative|consultant|agent|operator|supervisor|intern|trainee|nurse|doctor|pharmacist|lead|head|director|administrator|executive|associate|programmer|architect|cashier|receptionist|secretary)/i;
const CITIES = /(الرياض|جده|الدمام|مكه|المدينه|الخبر|الظهران|الطائف|تبوك|ابها|القصيم|بريده|حائل|جازان|نجران|الاحساء|الجبيل|ينبع|الباحه|عرعر|سكاكا|خميس مشيط|riyadh|jeddah|jiddah|dammam|makkah|mecca|madinah|medina|khobar|dhahran|taif|tabuk|abha|qassim|buraidah|hail|jazan|najran|ahsa|jubail|yanbu|remote|عن بعد|saudi arabia|السعوديه|ksa)/i;
const BULLET = /^[•·▪●◦○■□➢➤✓✔*\-–]\s*/;

function parseDate(raw: string): YearMonth | null {
  const text = normalizeArabic(raw).replace(/\.$/, '');
  const hijri = /^(1[34]\d{2})\s*ه/.exec(text);
  if (hijri) return { year: Math.round(Number(hijri[1]) * 0.970229 + 621.5643), month: null };
  const named = new RegExp(`^(${MONTH_ALT})\\.?\\s+(\\d{4})$`, 'i').exec(text);
  if (named && MONTHS[named[1]!.toLowerCase()]) return { year: Number(named[2]), month: MONTHS[named[1]!.toLowerCase()] ?? null };
  const monthYear = /^(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(text);
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
  return years > 0 ? years * 12 : years === 0 ? null : null;
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

function dateAr(value: string | null): string {
  const parsed = deserialize(value);
  if (!parsed) return '';
  return parsed.month ? `${MONTH_NAMES_AR[parsed.month - 1]} ${arDigits(parsed.year)}` : arDigits(parsed.year);
}
export function periodAr(item: Pick<ExperienceItem, 'start' | 'end' | 'current'>): string {
  const start = dateAr(item.start);
  if (!start) return '';
  if (item.current) return `${start} – الآن`;
  const end = dateAr(item.end);
  return end && end !== start ? `${start} – ${end}` : start;
}

/** One clean line per role, e.g. «محلل بيانات · شركة المراعي، الرياض · ٢٠٢٢ – الآن (٤ سنوات) — بنى لوحات Power BI». */
export function formatExperience(item: ExperienceItem, now = new Date()): string {
  const where = [item.organization, item.location].filter(Boolean).join('، ');
  const period = periodAr(item);
  const duration = durationAr(monthsOf(item, now));
  const head = [item.title, where, period ? `${period}${duration ? ` (${duration})` : ''}` : ''].filter(Boolean).join(' · ');
  const highlight = item.highlights[0];
  return highlight ? `${head} — ${highlight}` : head;
}

/** Total experience without double-counting overlapping roles, in years (one decimal). */
export function totalYears(items: ExperienceItem[], now = new Date()): number | null {
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

function cleanPart(part: string): string {
  let value = part.replace(BULLET, '').replace(/^[\s\-–—|·:،,]+|[\s\-–—|·:،,]+$/g, '').replace(/\s+/g, ' ').trim();
  // Drop only unbalanced brackets: keep «Call Center Agent (chat)».
  if (value.startsWith('(') && !value.includes(')')) value = value.slice(1).trim();
  if (value.endsWith(')') && !value.includes('(')) value = value.slice(0, -1).trim();
  if ((value.match(/\(/g) ?? []).length > (value.match(/\)/g) ?? []).length) value = `${value})`;
  return value;
}

/** Splits «محلل بيانات - شركة المراعي - الرياض» / «Data Analyst at Almarai | Riyadh» into title, organisation, location. */
export function splitHeader(parts: string[]): Pick<ExperienceItem, 'title' | 'organization' | 'location'> {
  const pieces = parts
    .flatMap(part => part.split(/\s+[-–—|·•]\s+|\s*[|·•]\s*|\s+(?:at|@|لدى|لدي)\s+|\s+في\s+(?=(?:شركة|شركه|مؤسسة|مؤسسه|بنك|وزارة|وزاره|هيئة|هيئه|جامعة|جامعه|مستشفى|مستشفي|مركز|مجموعة|مجموعه|جمعية|جمعيه))|\s*،\s*|,\s*/i))
    .map(cleanPart).filter(piece => piece.length >= 2 && piece.length <= 90 && !/^\d+$/.test(piece));
  let title = ''; let organization = ''; let location = '';
  for (const piece of pieces) {
    const key = normalizeArabic(piece);
    if (!location && CITIES.test(key) && key.split(' ').length <= 3 && !ORG.test(key)) { location = piece; continue; }
    if (!organization && ORG.test(key) && !(TITLE.test(key) && !title)) { organization = piece; continue; }
    if (!title && TITLE.test(key)) { title = piece; continue; }
  }
  const rest = pieces.filter(piece => ![title, organization, location].includes(piece) && !/^(خبره|خبرة|experience)$/i.test(normalizeArabic(piece)));
  if (!title) title = rest.shift() ?? '';
  if (!organization) organization = rest.shift() ?? '';
  return { title, organization, location };
}

/** «مستشفى الملك فهد بالدمام في رعاية المرضى» → organisation + the description that followed it. */
function separateDescription(organization: string): { organization: string; description: string } {
  if (organization.split(' ').length <= 5) return { organization, description: '' };
  const cut = /\s(?:في|حيث|where|working on|responsible for)\s/i.exec(organization);
  if (!cut || cut.index < 4) return { organization, description: '' };
  return { organization: organization.slice(0, cut.index).trim(), description: organization.slice(cut.index).replace(/^\s*(?:في|حيث)\s*/, '').trim() };
}

const DEGREE = /(بكالوريوس|بكالريوس|ماجستير|دكتوراه|دبلوم|ثانوي|ثانويه|bachelor|master|phd|diploma|degree|b\.?sc|m\.?sc|ba\b|ma\b|mba|high school)/i;

/** Parses an experience section (or the whole CV when it has none) into roles. */
export function parseExperience(lines: string[]): ExperienceItem[] {
  const items: (ExperienceItem & { details: string[] })[] = [];
  let buffer: string[] = [];
  let current: (ExperienceItem & { details: string[] }) | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = BULLET.test(line);
    const range = bullet ? null : findDateRange(line);
    if (range && !DEGREE.test(normalizeArabic(line))) {
      // «العنوان - الجهة - 2022 - الآن: الوصف»
      const withoutDate = toAsciiDigits(line).replace(range.text, ' ');
      const [head, ...descParts] = withoutDate.split(/[:：]\s+/);
      const header = splitHeader([...buffer, head ?? '']);
      const split = separateDescription(header.organization);
      const details = [split.description, descParts.join(': ')].filter(Boolean);
      current = { ...header, organization: split.organization, start: range.start, end: range.end, current: range.current, highlights: [], details };
      items.push(current);
      buffer = [];
    } else if (bullet || (current && line.length > 70)) {
      if (current) current.details.push(cleanPart(line));
    } else if (current && !current.organization && !current.details.length && line.length <= 70) {
      const extra = splitHeader([line]);
      current.organization = extra.organization || extra.title;
      current.location ||= extra.location;
    } else if (line.length <= 90) {
      buffer.push(line);
      if (buffer.length > 3) buffer.shift();
    }
  }
  return items.map(({ details, ...item }) => ({ ...item, highlights: uniqueStrings(details.map(cleanPart).filter(detail => detail.length >= 6).map(detail => (detail.length > 130 ? `${detail.slice(0, 127).replace(/\s\S*$/, '')}…` : detail).replace(/\.+$/, '')), 3) }))
    .filter(item => item.title || item.organization);
}

export interface EducationItem { degree: string; institution: string; year: string | null }
export function parseEducation(lines: string[]): EducationItem[] {
  const out: EducationItem[] = [];
  for (const line of lines) {
    if (BULLET.test(line) && !DEGREE.test(normalizeArabic(line))) continue;
    const years = [...normalizeArabic(line).matchAll(/(?:19|20)\d{2}/g)].map(match => match[0]);
    const text = line.replace(/\(?\s*(?:19|20)\d{2}\s*(?:[-–—]\s*(?:(?:19|20)\d{2}|الآن|present))?\s*\)?/g, ' ');
    const parts = text.split(/\s+[-–—|·•]\s+|\s*[|·•،,]\s*|\s+(?:from|at|من)\s+(?=(?:جامعة|جامعه|كلية|كليه|معهد|university|college|institute))/i).map(cleanPart).filter(part => part.length >= 2);
    const degree = parts.find(part => DEGREE.test(normalizeArabic(part))) ?? '';
    const institution = parts.find(part => part !== degree && /(جامعه|كليه|معهد|مدرسه|ثانويه|university|college|institute|school|academy|اكاديميه)/i.test(normalizeArabic(part))) ?? '';
    if (!degree && !institution) continue;
    const last = out[out.length - 1];
    if (last && !last.institution && !degree && institution) { last.institution = institution; last.year ??= years.at(-1) ?? null; continue; }
    out.push({ degree: degree || parts.filter(part => part !== institution)[0] || '', institution, year: years.at(-1) ?? null });
  }
  return out.slice(0, 5);
}
export const formatEducation = (item: EducationItem) => [item.degree, item.institution, item.year ? arDigits(item.year) : ''].filter(Boolean).join(' · ');

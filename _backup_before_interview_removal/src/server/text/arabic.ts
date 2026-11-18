/**
 * Arabic-aware normalisation used for matching skills, job titles and sign-language glosses.
 * It folds spelling variants (أ/إ/آ → ا, ى → ي, ة → ه), strips diacritics and tatweel,
 * converts Arabic-Indic digits and lower-cases Latin text.
 */
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;
const PERSIAN_DIGITS = /[\u06F0-\u06F9]/g;

export function normalizeArabic(input: string): string {
  return input
    .normalize('NFKC')
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(ARABIC_DIGITS, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, digit => String(digit.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[\u200c-\u200f]/g, '')
    .replace(/[^\p{L}\p{N}+#.\s/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  return normalizeArabic(input).split(/[\s/-]+/).map(token => token.replace(/^\.+|\.+$/g, '')).filter(Boolean);
}

const PREFIXES = ['وبال', 'وال', 'بال', 'كال', 'فال', 'لل', 'ال', 'و', 'ب', 'ل', 'ف', 'ك'];
const SUFFIXES = ['هما', 'كما', 'تين', 'تم', 'ين', 'ون', 'ات', 'ان', 'ها', 'هم', 'كم', 'نا', 'ني', 'ه', 'ك', 'ي', 'ت'];

/** Light stemming: candidate base forms of an Arabic word, most specific first. */
export function arabicVariants(word: string): string[] {
  const base = normalizeArabic(word);
  const out = new Set<string>([base]);
  if (!/[\u0600-\u06FF]/.test(base)) return [...out];
  for (const prefix of PREFIXES) {
    if (base.startsWith(prefix) && base.length - prefix.length >= 2) out.add(base.slice(prefix.length));
  }
  for (const form of [...out]) {
    for (const suffix of SUFFIXES) {
      if (form.endsWith(suffix) && form.length - suffix.length >= 2) out.add(form.slice(0, -suffix.length));
    }
  }
  return [...out];
}

export function uniqueStrings(values: Iterable<string>, limit = Infinity): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.replace(/\s+/g, ' ').trim();
    const key = normalizeArabic(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

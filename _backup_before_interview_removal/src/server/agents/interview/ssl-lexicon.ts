import fs from 'node:fs';
import path from 'node:path';
import type { SignClip } from '../../db/schema';
import { env } from '../../env';
import { arabicVariants, normalizeArabic, tokenize } from '../../text/arabic';
import { datasetCsvPath } from './capabilities';

/**
 * Saudi Sign Language lexicon built from the SSL dataset (sshi.sa library, 8,763 sign videos).
 * Turns Arabic text into a playlist of sign videos: longest phrase match first, then single words
 * with light stemming, then fingerspelling with the SSL alphabet for names and unknown short words.
 */
export interface SignEntry {
  videoId: string; label: string; labelEn: string; category: string; categoryAr: string;
  file: string; sourceUrl: string; duration: number; verified: boolean;
}

interface Lexicon { entries: SignEntry[]; byKey: Map<string, SignEntry[]>; bySkeleton: Map<string, SignEntry>; letters: Map<string, SignEntry>; maxPhraseWords: number; byId: Map<string, SignEntry> }

// Categories whose signs are the everyday choice when a word has several videos.
const CATEGORY_PRIORITY = ['39_common_words', '14_social_relations', '05_adjectives_and_states', '19_jobs_and_careers', '07_education_and_training', '04_management_economics_and_accounting', '25_coputer', '20_measures_and_times', '03_directions_and_positions', '24_social_education', '15_family_and_society'];
// Words usually dropped when signing (SSL is topic–comment and omits most particles).
const DROP = new Set(['في', 'الي', 'علي', 'عن', 'ان', 'قد', 'ثم', 'او', 'يا', 'ذلك', 'تلك', 'التي', 'الذي', 'الذين', 'كان', 'لقد', 'به', 'بها', 'له', 'لها', 'لك', 'لنا', 'هو', 'هي', 'ايضا', 'حول', 'خلال', 'عند', 'بعض', 'كل', 'اي', 'لدي', 'لديك', 'فيه', 'فيها', 'منه', 'منها', 'عليه', 'عليها', 'اليه', 'لديه', 'التي', 'هذا', 'هذه']);

/**
 * Interview vocabulary → the dataset sign that carries the meaning (keys and values normalised).
 * e.g. the imperative "احكِ" (tell us) is signed with "كلام", "تريد" with "أريد".
 */
const INTERVIEW_GLOSSES: Record<string, string> = {
  احك: 'كلام', احكي: 'كلام', حدثنا: 'كلام', حدثني: 'كلام', اخبرنا: 'كلام', اخبرني: 'كلام', تحدث: 'كلام', تكلم: 'كلام', كلمنا: 'كلام',
  تريد: 'اريد', يريد: 'اريد', تريدين: 'اريد', تودين: 'اريد', تود: 'اريد',
  ما: 'ماذا', وما: 'ماذا',
  تتاكد: 'متاكد', تاكد: 'متاكد', اتاكد: 'متاكد', يتاكد: 'متاكد',
  حققته: 'حقق', حققت: 'حقق', حققتها: 'حقق', تحقق: 'حقق',
  اجابه: 'جواب', اجابتك: 'جواب', اجابتي: 'جواب',
  تعرف: 'معرفه', يعرف: 'معرفه', اعرف: 'معرفه',
  تتعلم: 'تعلم', يتعلم: 'تعلم', تعلمت: 'تعلم', اتعلم: 'تعلم',
  تفهم: 'فهم', يفهم: 'فهم', افهم: 'فهم',
  تشرح: 'شرح', يشرح: 'شرح', اشرح: 'شرح',
  مهاره: 'مهارات', مهاراتك: 'مهارات', مهاراتي: 'مهارات',
  خبراتك: 'خبره', خبرات: 'خبره', خبرتك: 'خبره', خبرتي: 'خبره',
  ممكن: 'يستطيع', تستطيع: 'يستطيع', تقدر: 'يستطيع', يمكنك: 'يستطيع',
  تعمل: 'عمل', يعمل: 'عمل', اعمل: 'عمل', عملت: 'عمل', عملك: 'عمل',
};

/** Consonant skeleton: drops long vowels so verb and verbal-noun forms meet (استخدم ↔ استخدام، تعاون ↔ التعاون). */
function skeleton(word: string): string {
  return word.replace(/^ال/, '').replace(/[اويى]/g, '');
}

let cache: Lexicon | null | undefined;

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = ''; if (row.some(cell => cell.length)) rows.push(row); row = [];
    } else field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map(key => key.replace(/^\uFEFF/, '').trim());
  return body.map(cells => Object.fromEntries(keys.map((key, index) => [key, cells[index] ?? ''])));
}

function labelKeys(label: string): string[] {
  // "دخول / داخل", "يبني - بناء", "تفصيل(تفاصيل)" → each variant is a key.
  const parts = label.split(/\s[-–]\s|\/|-|\(|\)|،|,/).map(part => part.trim()).filter(Boolean);
  return [...new Set([label, ...parts].map(normalizeArabic).filter(key => key.length >= 1))];
}

function rank(entry: SignEntry): number {
  const priority = CATEGORY_PRIORITY.indexOf(entry.category);
  return (entry.verified ? 0 : 100) + (priority === -1 ? 50 : priority) + Math.min(entry.duration, 10) / 10;
}

export function loadLexicon(): Lexicon | null {
  if (cache !== undefined) return cache;
  const csvPath = datasetCsvPath();
  if (!fs.existsSync(csvPath)) { cache = null; return cache; }
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).filter(row => row['video_id'] && row['label_ar']);
  const entries: SignEntry[] = rows.map(row => ({
    videoId: row['video_id']!, label: row['label_ar']!.trim(), labelEn: row['label_en'] ?? '', category: row['category'] ?? '', categoryAr: row['category_ar'] ?? '',
    file: row['filename'] ?? '', sourceUrl: row['source_url'] ?? '', duration: Number(row['duration'] ?? '0') || 0, verified: row['verification_status'] === 'source_label',
  }));
  const byKey = new Map<string, SignEntry[]>();
  const add = (key: string, entry: SignEntry) => { const list = byKey.get(key) ?? []; if (!list.includes(entry)) list.push(entry); byKey.set(key, list); };
  const byId = new Map(entries.map(entry => [entry.videoId, entry]));
  for (const [index, entry] of entries.entries()) {
    const row = rows[index]!;
    for (const key of labelKeys(entry.label)) add(key, entry);
    for (const alias of (row['aliases_ar'] ?? '').split(/[;|]/)) if (alias.trim() && !/^\d+$/.test(alias.trim())) for (const key of labelKeys(alias)) add(key, entry);
    // Synonyms in single-word entries only (multi-word synonym text is usually a description).
    for (const synonym of (row['synonym'] ?? '').split(/[,،]/)) if (synonym.trim() && synonym.trim().split(/\s+/).length <= 2 && entry.category !== '01_signal_alphabet_letters') add(normalizeArabic(synonym), entry);
  }
  // Word → sign pairs from the site's own sentence packs.
  const packs = path.join(env.sslDatasetDir, 'dataset', 'metadata', 'raw', 'sentences.json');
  if (fs.existsSync(packs)) {
    try {
      const data = JSON.parse(fs.readFileSync(packs, 'utf8')) as { packs?: { sentences?: { signs?: { word?: string; term?: { id?: number } }[] }[] }[] };
      for (const pack of data.packs ?? []) for (const sentence of pack.sentences ?? []) for (const sign of sentence.signs ?? []) {
        const entry = sign.term?.id ? byId.get(`ssl_${String(sign.term.id).padStart(5, '0')}`) : undefined;
        if (entry && sign.word) for (const key of labelKeys(sign.word)) add(key, entry);
      }
    } catch { /* optional */ }
  }
  for (const list of byKey.values()) list.sort((a, b) => rank(a) - rank(b));
  const bySkeleton = new Map<string, SignEntry>();
  for (const [key, list] of byKey) {
    const best = list[0];
    if (!best || key.includes(' ') || best.category === '01_signal_alphabet_letters') continue;
    const bone = skeleton(key);
    if (bone.length < 3) continue;
    const current = bySkeleton.get(bone);
    if (!current || rank(best) < rank(current)) bySkeleton.set(bone, best);
  }
  const letters = new Map<string, SignEntry>();
  for (const entry of entries) if (entry.category === '01_signal_alphabet_letters' && entry.label.length <= 2) letters.set(entry.label, entry);
  const maxPhraseWords = Math.min(5, Math.max(...[...byKey.keys()].map(key => key.split(' ').length)));
  cache = { entries, byKey, bySkeleton, letters, maxPhraseWords, byId };
  return cache;
}

export function resetLexiconForTests() { cache = undefined; }

export function signEntry(videoId: string): SignEntry | undefined { return loadLexicon()?.byId.get(videoId); }

/** Local file when the LFS videos were pulled, otherwise the original sshi.sa URL. */
export function videoUrlFor(entry: SignEntry): string {
  const local = path.join(env.sslDatasetDir, 'dataset', 'videos', entry.file);
  try { if (fs.statSync(local).size > 2048) return `/api/ssl/videos/${entry.videoId}`; } catch { /* not downloaded */ }
  return entry.sourceUrl;
}

export function localVideoPath(videoId: string): string | null {
  const entry = signEntry(videoId);
  if (!entry) return null;
  const local = path.join(env.sslDatasetDir, 'dataset', 'videos', entry.file);
  try { return fs.statSync(local).size > 2048 ? local : null; } catch { return null; }
}

function lookup(lexicon: Lexicon, key: string): SignEntry | undefined {
  return lexicon.byKey.get(key)?.[0];
}

function lookupWord(lexicon: Lexicon, word: string): SignEntry | undefined {
  const normalized = normalizeArabic(word);
  const curated = INTERVIEW_GLOSSES[normalized] ?? INTERVIEW_GLOSSES[normalized.replace(/^و/, '')];
  if (curated) { const hit = lookup(lexicon, curated); if (hit) return hit; }
  const variants = arabicVariants(word);
  for (const variant of variants) {
    const hit = lookup(lexicon, variant) ?? lookup(lexicon, `ال${variant}`);
    if (hit && hit.category !== '01_signal_alphabet_letters') return hit;
  }
  // Present-tense verbs: تتعاون → تعاون، يعمل → عمل.
  for (const variant of variants) {
    if (variant.length >= 4 && /^[تينا]/.test(variant)) {
      const hit = lookup(lexicon, variant.slice(1));
      if (hit && hit.category !== '01_signal_alphabet_letters') return hit;
    }
  }
  // Verb ↔ verbal-noun forms (استخدمت → استخدام). Only for words long enough to be unambiguous.
  for (const variant of variants) {
    const bone = skeleton(variant);
    if (bone.length >= 3 && variant.length >= 4) {
      const hit = lexicon.bySkeleton.get(bone);
      if (hit) return hit;
    }
  }
  return undefined;
}

function clip(entry: SignEntry, gloss: string, kind: SignClip['kind']): SignClip {
  return { gloss, videoId: entry.videoId, url: videoUrlFor(entry), kind, duration: entry.duration };
}

function fingerspell(lexicon: Lexicon, word: string): SignClip[] {
  const out: SignClip[] = [];
  for (const char of word.replace(/[\u064B-\u065F\u0670\u0640]/g, '')) {
    const entry = lexicon.letters.get(char) ?? lexicon.letters.get(normalizeArabic(char));
    if (entry) out.push(clip(entry, char, 'letter'));
  }
  return out;
}

/**
 * Text → SSL playlist. `glosses` (when given, e.g. from Claude) are used in that order;
 * otherwise the text itself is segmented.
 */
export function textToSigns(text: string, glosses?: string[]): SignClip[] {
  const lexicon = loadLexicon();
  const source = glosses?.length ? glosses.join(' ') : text;
  if (!lexicon) return tokenize(source).filter(word => !DROP.has(word)).map(word => ({ gloss: word, videoId: null, url: null, kind: 'missing' as const }));
  const words = tokenize(source).filter(word => !/^\d+$/.test(word) || word.length <= 3);
  const playlist: SignClip[] = [];
  for (let i = 0; i < words.length;) {
    let matched = false;
    for (let size = Math.min(lexicon.maxPhraseWords, words.length - i); size >= 2; size -= 1) {
      const phrase = words.slice(i, i + size).join(' ');
      const entry = lookup(lexicon, phrase);
      if (entry) { playlist.push(clip(entry, phrase, 'word')); i += size; matched = true; break; }
    }
    if (matched) continue;
    const word = words[i]!; i += 1;
    if (DROP.has(word)) continue;
    const entry = lookupWord(lexicon, word);
    if (entry) playlist.push(clip(entry, word, 'word'));
    else if (/^[\u0600-\u06FF]{2,6}$/.test(word)) playlist.push(...fingerspell(lexicon, word));
    else playlist.push({ gloss: word, videoId: null, url: null, kind: 'missing' });
  }
  return playlist;
}

export function searchSigns(query: string, limit = 20): { videoId: string; label: string; labelEn: string; category: string; url: string }[] {
  const lexicon = loadLexicon();
  const key = normalizeArabic(query);
  if (!lexicon || !key) return [];
  const exact = lexicon.byKey.get(key) ?? [];
  const partial = exact.length >= limit ? [] : lexicon.entries.filter(entry => normalizeArabic(entry.label).includes(key) || entry.labelEn.toLowerCase().includes(key));
  return [...new Set([...exact, ...partial])].slice(0, limit).map(entry => ({ videoId: entry.videoId, label: entry.label, labelEn: entry.labelEn, category: entry.categoryAr, url: videoUrlFor(entry) }));
}

/** Labels likely to appear in an answer to this question — given to the recognizer as context. */
export function vocabularyFor(question: string, jobText: string, limit = 160): string[] {
  const lexicon = loadLexicon();
  if (!lexicon) return [];
  const answerWords = ['أنا', 'نعم', 'لا', 'عمل', 'خبرة', 'فريق', 'مشكلة', 'حل', 'نتيجة', 'شركة', 'سنة', 'تعلم', 'مستقبل', 'مساعدة', 'تقرير', 'بيانات', 'تحليل', 'عميل', 'تصميم', 'برنامج', 'حاسب', 'مدير', 'زميل', 'اجتماع', 'مشروع', 'جامعة', 'شهادة', 'شكراً', 'أحب', 'يريد', 'صعب', 'سهل', 'سريع', 'دقيق', 'مهم', 'كتابة', 'بريد', 'تواصل'];
  const fromText = tokenize(`${question} ${jobText}`).filter(word => word.length > 2 && !DROP.has(word));
  const labels: string[] = [];
  for (const word of [...answerWords, ...fromText]) {
    const entry = lookupWord(lexicon, word) ?? lookup(lexicon, normalizeArabic(word));
    if (entry && !labels.includes(entry.label)) labels.push(entry.label);
    if (labels.length >= limit) break;
  }
  return labels;
}

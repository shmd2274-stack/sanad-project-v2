import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import * as z from 'zod/v4';
import { validateCvFile } from '@/lib/sanad-data';
import type { CvProfileView } from '@/lib/sanad-snapshot';
import type { AuthUser } from '../../auth/session';
import { getDb } from '../../db/client';
import { cvDocuments, cvProfiles } from '../../db/schema';
import { env } from '../../env';
import { HttpError } from '../../http/core';
import { refreshMatches } from '../../services/candidate';
import { normalizeArabic, tokenize, uniqueStrings } from '../../text/arabic';
import { describeLlmError, llmAvailable, structured } from '../llm';
import { canonicalSkill, findSkills } from '../skills-taxonomy';
import { formatEducation, formatExperience, totalYears, type ExperienceItem } from './experience';
import { extractCvText, isPdf } from './extract-text';
import { careerLevelAr, heuristicProfile, sortRoles, toDetail } from './heuristic';
import { displaySkill } from './skills-extract';

const MIME: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export async function uploadCv(user: AuthUser, file: File) {
  const error = validateCvFile(file.name, file.size);
  if (error) throw new HttpError(400, 'invalid_cv', error);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  // Check the real content, not just the extension.
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  if ((extension === 'pdf' && !isPdf(bytes)) || (extension === 'docx' && !zip) || (extension === 'doc' && !ole && !zip)) {
    throw new HttpError(400, 'invalid_cv', 'محتوى الملف لا يطابق نوعه. اختر ملف PDF أو Word صحيحًا.');
  }
  const db = await getDb();
  const id = randomUUID();
  await db.insert(cvDocuments).values({
    id, userId: user.id, fileName: file.name.slice(0, 200), mimeType: MIME[extension] ?? 'application/octet-stream', sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes, status: 'uploaded',
  });
  return { id, name: file.name };
}

/* ───────────── Claude reading ───────────── */

const ClaudeCvSchema = z.object({
  summary: z.string().describe('ملخص مهني بالعربية في جملتين: من هو مهنيًا، وأقوى ما يميزه'),
  experience: z.array(z.object({
    title: z.string().describe('المسمى كما ورد في السيرة'),
    organization: z.string().describe('الجهة كما وردت في السيرة'),
    location: z.string().describe('المدينة إن ذُكرت، وإلا نص فارغ'),
    start: z.string().describe('YYYY-MM أو YYYY بالتقويم الميلادي (حوّل الهجري)، أو نص فارغ إن لم يُذكر'),
    end: z.string().describe('YYYY-MM أو YYYY، أو "present" إن كان مستمرًا، أو نص فارغ'),
    highlights: z.array(z.string()).describe('أهم إنجاز أو إنجازان، بالعربية، بجملة قصيرة تبدأ بفعل، مع الأرقام إن وُجدت'),
    evidence: z.string().describe('عبارة قصيرة منقولة حرفيًا من السيرة تثبت هذه الخبرة'),
  })),
  skills: z.array(z.object({
    name: z.string().describe('اسم المهارة الشائع: أدوات بأسمائها (Excel، Zendesk)، ومفاهيم بالعربية (خدمة العملاء)'),
    kind: z.enum(['technical', 'tool', 'soft']),
    evidence: z.string().describe('عبارة قصيرة منقولة حرفيًا من السيرة تظهر فيها المهارة'),
  })),
  education: z.array(z.object({ degree: z.string(), institution: z.string(), year: z.string() })),
  certifications: z.array(z.string()),
  languages: z.array(z.string()).describe('اللغات بالعربية، ومنها لغة الإشارة إن ذُكرت'),
  suggestedRoles: z.array(z.string()).describe('٣ إلى ٥ مسميات وظيفية بالعربية تناسبه فعلًا في سوق العمل السعودي'),
  searchKeywords: z.array(z.string()).describe('كلمات بحث عن وظائف له بالعربية والإنجليزية: مسميات ومهارات أساسية'),
});
type ClaudeCv = z.infer<typeof ClaudeCvSchema>;

const SYSTEM = `أنت وكيل قراءة السير الذاتية في سَند، منصة توظيف للصم وضعاف السمع في السعودية.
اقرأ السيرة كاملة كما يقرؤها مختص توظيف متمرس: افهم المسار المهني، وتسلسل الوظائف، وما أنجزه المرشح فعلًا، ثم ابنِ له ملفًا مهنيًا يُعرض عليه وتُطابق به الوظائف.

الأمانة قبل كل شيء: لا تضف وظيفة أو جهة أو مهارة أو تاريخًا غير موجود في السيرة. لكل خبرة ومهارة انقل عبارة قصيرة حرفيًا من نص السيرة دليلًا عليها؛ إن لم تجد دليلًا فلا تذكرها.
اذكر المهارات التي كتبها المرشح، والمهارات الظاهرة بوضوح من وصف خبراته (مثلًا من «أنشأت لوحات Power BI» تُستخرج Power BI). السيرة قد تكون من أي مجال: صحة، هندسة، تقنية، إدارة، حِرف، ضيافة، تعليم، وغيرها.
اكتب الإنجازات بعربية فصحى مختصرة وواضحة، مع الأرقام إن وُجدت. أبقِ المسميات وأسماء الجهات كما كُتبت.
في الوظائف المقترحة فكّر في ما يناسب خبرته الفعلية ومستواه، ويمكن أداؤه بتواصل كتابي أو مرئي.`;

/** Does a quote from Claude really occur in the CV? Tolerates spelling variants and small differences. */
export function supportedByText(quote: string, normalizedCv: string): boolean {
  const key = normalizeArabic(quote);
  if (key.length >= 3 && normalizedCv.includes(key)) return true;
  const words = tokenize(quote).filter(word => word.length > 2);
  if (!words.length) return false;
  const found = words.filter(word => normalizedCv.includes(word)).length;
  return found / words.length >= 0.7;
}

const DATE_VALUE = /^((?:19|20)\d{2})(?:-(0[1-9]|1[0-2]))?$/;
function cleanDate(value: string, now: Date): string | null {
  const match = DATE_VALUE.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) > now.getUTCFullYear() + 1 ? null : value.trim();
}

/** Keeps only what the CV supports, computes durations ourselves, and formats like the offline reader. */
export function verifiedClaudeProfile(ai: ClaudeCv, cvText: string, now = new Date(), canVerify = true): CvProfileView {
  const normalizedCv = normalizeArabic(cvText);
  const ok = (...quotes: string[]) => !canVerify || quotes.some(quote => quote && supportedByText(quote, normalizedCv));
  const roles: ExperienceItem[] = sortRoles(ai.experience
    .filter(item => ok(item.evidence, `${item.title} ${item.organization}`))
    .map(item => ({
      title: item.title.trim(), organization: item.organization.trim(), location: item.location.trim(),
      start: cleanDate(item.start, now), end: /present|current/i.test(item.end) ? null : cleanDate(item.end, now), current: /present|current/i.test(item.end),
      highlights: uniqueStrings(item.highlights.map(highlight => highlight.replace(/\.+$/, '').trim()), 2),
    })));
  const known = new Set(findSkills(cvText));
  const skills = uniqueStrings(ai.skills
    .filter(skill => ok(skill.evidence, skill.name) || known.has(canonicalSkill(skill.name)))
    .sort((a, b) => ['technical', 'tool', 'soft'].indexOf(a.kind) - ['technical', 'tool', 'soft'].indexOf(b.kind))
    .map(skill => displaySkill(skill.name)), 25);
  const yearsExperience = totalYears(roles, now);
  return {
    summary: ai.summary.trim(),
    skills,
    experience: roles.map(role => formatExperience(role, now)),
    experienceDetails: roles.map(role => toDetail(role, now)),
    education: uniqueStrings(ai.education.filter(item => ok(item.institution, item.degree)).map(item => formatEducation({ degree: item.degree, institution: item.institution, year: /\d{4}/.exec(item.year)?.[0] ?? null })), 5),
    jobTitles: uniqueStrings(roles.map(role => role.title), 6),
    languages: uniqueStrings(ai.languages, 6),
    certifications: uniqueStrings(ai.certifications.filter(item => ok(item)), 8),
    suggestedRoles: uniqueStrings(ai.suggestedRoles, 5),
    searchKeywords: uniqueStrings(ai.searchKeywords, 14),
    careerLevel: careerLevelAr(yearsExperience, roles.length > 0),
    yearsExperience,
    engine: 'claude',
  };
}

/** Claude's verified reading first; the offline reader fills whatever Claude left out. */
export function mergeProfiles(ai: CvProfileView, offline: CvProfileView): CvProfileView {
  const useOfflineRoles = !ai.experienceDetails.length && offline.experienceDetails.length > 0;
  const aiCanonical = new Set(ai.skills.map(skill => normalizeArabic(canonicalSkill(skill))));
  return {
    ...ai,
    summary: ai.summary || offline.summary,
    skills: uniqueStrings([...ai.skills, ...offline.skills.filter(skill => !aiCanonical.has(normalizeArabic(canonicalSkill(skill))))], 25),
    experience: useOfflineRoles ? offline.experience : ai.experience,
    experienceDetails: useOfflineRoles ? offline.experienceDetails : ai.experienceDetails,
    jobTitles: useOfflineRoles ? offline.jobTitles : ai.jobTitles,
    education: ai.education.length ? ai.education : offline.education,
    certifications: ai.certifications.length ? ai.certifications : offline.certifications,
    languages: uniqueStrings([...ai.languages, ...offline.languages], 6),
    yearsExperience: useOfflineRoles ? offline.yearsExperience : ai.yearsExperience ?? offline.yearsExperience,
    careerLevel: useOfflineRoles ? offline.careerLevel : ai.careerLevel ?? offline.careerLevel,
    suggestedRoles: ai.suggestedRoles.length ? ai.suggestedRoles : offline.suggestedRoles,
    searchKeywords: uniqueStrings([...ai.searchKeywords, ...offline.searchKeywords], 16),
  };
}

async function claudeReading(text: string, pdfBytes: Uint8Array, scanned: boolean): Promise<ClaudeCv | null> {
  const content = scanned
    ? [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: Buffer.from(pdfBytes).toString('base64') } }, { type: 'text' as const, text: `اقرأ هذه السيرة الذاتية. تاريخ اليوم ${new Date().toISOString().slice(0, 10)}.` }]
    : `تاريخ اليوم ${new Date().toISOString().slice(0, 10)}. السيرة الذاتية:\n\n<cv>\n${text.slice(0, 120_000)}\n</cv>`;
  return structured({ schema: ClaudeCvSchema, system: SYSTEM, content, effort: 'high', maxTokens: 12000 });
}

/* ───────────── Pipeline ───────────── */

const running = new Map<string, Promise<void>>();
type AfterAnalysis = (userId: string) => void;
let afterAnalysis: AfterAnalysis | null = null;
/** The jobs agent registers here to search for jobs that fit a freshly analysed CV. */
export function onCvAnalysed(callback: AfterAnalysis) { afterAnalysis = callback; }

/** Starts analysis in the background; the client polls the CV status. */
export async function startCvAnalysis(user: AuthUser) {
  const db = await getDb();
  const [cv] = await db.select().from(cvDocuments).where(eq(cvDocuments.userId, user.id)).orderBy(desc(cvDocuments.createdAt)).limit(1);
  if (!cv) throw new HttpError(404, 'cv_missing', 'ارفع سيرتك الذاتية أولًا.');
  if (cv.status === 'analysing' && running.has(cv.id)) return { id: cv.id, status: 'analysing' as const };
  await db.update(cvDocuments).set({ status: 'analysing', error: null }).where(eq(cvDocuments.id, cv.id));
  const job = analyse(user.id, cv.id).finally(() => running.delete(cv.id));
  running.set(cv.id, job);
  return { id: cv.id, status: 'analysing' as const };
}

/** Waits for a running analysis (used by tests and bulk processing). */
export async function waitForCvAnalysis(cvId: string) { await running.get(cvId); }

/**
 * 1. extract the text  2. read it offline (sections, roles, dates, skills)
 * 3. Claude reads it with quotes as evidence  4. verify every quote against the CV
 * 5. merge, store, re-match every job, and start a personalised job search.
 */
async function analyse(userId: string, cvId: string) {
  const db = await getDb();
  try {
    const [cv] = await db.select().from(cvDocuments).where(and(eq(cvDocuments.id, cvId), eq(cvDocuments.userId, userId)));
    if (!cv) return;
    const text = cv.extractedText ?? await extractCvText(cv.content, cv.fileName).catch(() => '');
    if (!cv.extractedText) await db.update(cvDocuments).set({ extractedText: text }).where(eq(cvDocuments.id, cvId));
    // Almost no text layer → likely a scanned image (Claude can still read the PDF itself).
    const scanned = text.replace(/\s/g, '').length < 40;
    if (scanned && !(llmAvailable() && isPdf(cv.content))) throw new Error('empty_text');

    const offline = heuristicProfile(text);
    let profile: CvProfileView = offline;
    if (llmAvailable()) {
      try {
        const ai = await claudeReading(text, cv.content, scanned);
        if (ai) profile = mergeProfiles(verifiedClaudeProfile(ai, text, new Date(), !scanned), offline);
      } catch (error) {
        console.warn('[cv-agent] Claude reading failed, using the offline reader:', describeLlmError(error));
      }
    }
    if (!profile.skills.length && !profile.experience.length && !profile.education.length) throw new Error('nothing_found');

    const values = {
      cvId, summary: profile.summary, skills: profile.skills, experience: profile.experience, experienceDetails: profile.experienceDetails,
      education: profile.education, jobTitles: profile.jobTitles, languages: profile.languages, certifications: profile.certifications,
      suggestedRoles: profile.suggestedRoles, searchKeywords: profile.searchKeywords, careerLevel: profile.careerLevel,
      yearsExperience: profile.yearsExperience, engine: profile.engine, updatedAt: new Date(),
    };
    await db.insert(cvProfiles).values({ userId, ...values }).onConflictDoUpdate({ target: cvProfiles.userId, set: values });
    await refreshMatches(db, userId);
    await db.update(cvDocuments).set({ status: 'analysed', analysedAt: new Date(), error: null }).where(eq(cvDocuments.id, cvId));
    afterAnalysis?.(userId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = reason === 'empty_text' ? 'تعذّر قراءة نص السيرة (قد تكون صورة ممسوحة). ارفع ملفًا نصيًا PDF أو Word.'
      : reason === 'nothing_found' ? 'لم نجد مهارات أو خبرات واضحة في الملف. تأكد أنه سيرة ذاتية.'
        : 'تعذّر تحليل السيرة الذاتية. حاول مرة أخرى.';
    if (reason !== 'empty_text' && reason !== 'nothing_found') console.error('[cv-agent]', error);
    await db.update(cvDocuments).set({ status: 'failed', error: message }).where(eq(cvDocuments.id, cvId));
  }
}

export const cvAgentInfo = () => ({ engine: llmAvailable() ? `claude:${env.anthropicModel}+verified+offline-reader` : 'offline-reader' });

import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as z from 'zod/v4';
import { validateCvFile } from '@/lib/sanad-data';
import type { CvProfileView } from '@/lib/sanad-snapshot';
import type { AuthUser } from '../../auth/session';
import { getDb } from '../../db/client';
import { cvDocuments, cvProfiles, jobMatches } from '../../db/schema';
import { env } from '../../env';
import { HttpError } from '../../http/core';
import { refreshMatches } from '../../services/candidate';
import { normalizeArabic, tokenize, uniqueStrings } from '../../text/arabic';
import { describeLlmError, llmAvailable, structured } from '../llm';
import { CvPipeline } from '../pipeline';
import { canonicalSkill, findSkills, skillGroup } from '../skills-taxonomy';
import { formatEducation, formatExperience, totalYears, type ExperienceItem } from './experience';
import { extractCvText, isPdf } from './extract-text';
import { careerLevelAr, heuristicProfile, orderRoles, PARSER_VERSION, toDetail } from './heuristic';
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
    organization: z.string().describe('الجهة كما وردت في السيرة (بدون اسم المدينة)'),
    location: z.string().describe('المدينة إن ذُكرت، وإلا نص فارغ'),
    kind: z.enum(['job', 'internship', 'volunteer']).describe('job وظيفة، internship تدريب تعاوني أو تمهير أو Co-op أو Trainee، volunteer عمل تطوعي أو نشاط طلابي'),
    start: z.string().describe('YYYY-MM أو YYYY بالتقويم الميلادي (حوّل الهجري)، أو نص فارغ إن لم يُذكر'),
    end: z.string().describe('YYYY-MM أو YYYY، أو "present" إن كان مستمرًا، أو نص فارغ'),
    highlights: z.array(z.string()).describe('أهم إنجاز أو إنجازان، بالعربية، بجملة قصيرة تبدأ بفعل، مع الأرقام إن وُجدت'),
    evidence: z.string().describe('عبارة قصيرة منقولة حرفيًا من السيرة تثبت هذه الخبرة'),
  })),
  skills: z.array(z.object({
    name: z.string().describe('اسم المهارة الشائع: أدوات بأسمائها (Excel، Python، Figma)، ومفاهيم بالعربية (تحليل البيانات، خدمة العملاء)'),
    kind: z.enum(['technical', 'tool', 'soft']),
    evidence: z.string().describe('عبارة قصيرة منقولة حرفيًا من السيرة تظهر فيها المهارة'),
  })),
  education: z.array(z.object({ degree: z.string(), institution: z.string(), year: z.string().describe('سنة التخرج أو نص فارغ'), gpa: z.string().describe('المعدل كما كُتب أو نص فارغ') })),
  certifications: z.array(z.string()).describe('كل شهادة بصيغة «الاسم – الجهة المانحة» كما وردت'),
  projects: z.array(z.object({ name: z.string(), tools: z.array(z.string()).describe('الأدوات والتقنيات المذكورة للمشروع'), description: z.string().describe('جملة واحدة بالعربية') })),
  languages: z.array(z.string()).describe('اللغات بالعربية، ومنها لغة الإشارة إن ذُكرت'),
  suggestedRoles: z.array(z.string()).describe('٣ إلى ٥ مسميات وظيفية بالعربية تناسبه فعلًا في سوق العمل السعودي'),
  searchKeywords: z.array(z.string()).describe('الكلمات المفتاحية التي يفهرس بها نظام ATS هذه السيرة ويبحث بها عن وظائف له، بالعربية والإنجليزية: مسميات ومهارات أساسية'),
});
type ClaudeCv = z.infer<typeof ClaudeCvSchema>;

const SYSTEM = `أنت وكيل قراءة السير الذاتية في سَند، منصة توظيف للصم وضعاف السمع في السعودية.
اقرأ السيرة كما يقرؤها نظام تتبع المتقدمين (ATS) ومختص توظيف متمرس معًا: استخرج الحقول المعيارية (الخبرات، التعليم، المهارات، الشهادات، المشاريع، اللغات)، وافهم المسار المهني وتسلسله وما أنجزه المرشح فعلًا، ثم ابنِ له ملفًا مهنيًا يُعرض عليه وتُطابق به الوظائف.

الأمانة قبل كل شيء: لا تضف وظيفة أو جهة أو مهارة أو تاريخًا غير موجود في السيرة. لكل خبرة ومهارة انقل عبارة قصيرة حرفيًا من نص السيرة دليلًا عليها؛ إن لم تجد دليلًا فلا تذكرها.
فرّق بين الوظيفة والتدريب التعاوني (Co-op، Tamheer، Trainee) والعمل التطوعي. لا تعدّ اسم الجهة مهارة (هيئة الأمن السيبراني ليست مهارة أمن سيبراني).
اذكر المهارات التي كتبها المرشح، وأدوات المشاريع، والمهارات الظاهرة بوضوح من وصف خبراته (مثلًا من «أنشأت لوحات Power BI» تُستخرج Power BI). السيرة قد تكون من أي مجال: صحة، هندسة، تقنية، أمن سيبراني، إدارة، حِرف، ضيافة، تعليم، وغيرها، وبالعربية أو الإنجليزية.
اكتب الإنجازات بعربية فصحى مختصرة وواضحة، مع الأرقام إن وُجدت. أبقِ المسميات وأسماء الجهات كما كُتبت.
في الوظائف المقترحة فكّر في ما يناسب خبرته الفعلية ومستواه (حديث التخرج يناسبه برامج الخريجين والوظائف المبتدئة)، ويمكن أداؤه بتواصل كتابي أو مرئي.`;

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
  const roles: ExperienceItem[] = orderRoles(ai.experience
    .filter(item => ok(item.evidence, `${item.title} ${item.organization}`))
    .map(item => ({
      title: item.title.trim(), organization: item.organization.trim(), location: item.location.trim(), kind: item.kind,
      start: cleanDate(item.start, now), end: /present|current/i.test(item.end) ? null : cleanDate(item.end, now), current: /present|current/i.test(item.end),
      highlights: uniqueStrings(item.highlights.map(highlight => highlight.replace(/\.+$/, '').trim()), 2),
    })));
  const work = roles.filter(role => role.kind !== 'volunteer');
  const known = new Set(findSkills(cvText));
  const skills = uniqueStrings(ai.skills
    .filter(skill => ok(skill.evidence, skill.name) || known.has(canonicalSkill(skill.name)))
    .sort((a, b) => ['technical', 'tool', 'soft'].indexOf(a.kind) - ['technical', 'tool', 'soft'].indexOf(b.kind))
    .map(skill => displaySkill(skill.name)), 30);
  const yearsExperience = totalYears(work, now);
  return {
    summary: ai.summary.trim(),
    skills,
    experience: roles.map(role => formatExperience(role, now)),
    experienceDetails: roles.map(role => toDetail(role, now)),
    education: uniqueStrings(ai.education.filter(item => ok(item.institution, item.degree)).map(item => formatEducation({ degree: item.degree, institution: item.institution, year: /\d{4}/.exec(item.year)?.[0] ?? null, gpa: item.gpa?.trim() || null })), 5),
    jobTitles: uniqueStrings(work.map(role => role.title), 6),
    languages: uniqueStrings(ai.languages, 6),
    certifications: uniqueStrings(ai.certifications.filter(item => ok(item)).map(item => item.replace(/\s+[–—-]\s+/, ' · ')), 12),
    suggestedRoles: uniqueStrings(ai.suggestedRoles, 5),
    searchKeywords: uniqueStrings(ai.searchKeywords, 14),
    careerLevel: careerLevelAr(yearsExperience, roles.length > 0, work.length > 0 && work.every(role => role.kind === 'internship')),
    yearsExperience,
    projects: (ai.projects ?? []).filter(project => ok(project.name)).map(project => ({ name: project.name.trim(), tools: uniqueStrings(project.tools, 12), description: project.description.trim() })).slice(0, 8),
    ats: null,
    engine: 'claude',
  };
}

/** Claude's verified reading first; the offline reader fills whatever Claude left out and scores the CV for ATS. */
export function mergeProfiles(ai: CvProfileView, offline: CvProfileView): CvProfileView {
  const useOfflineRoles = !ai.experienceDetails.length && offline.experienceDetails.length > 0;
  const aiCanonical = new Set(ai.skills.map(skill => normalizeArabic(canonicalSkill(skill))));
  const skills = uniqueStrings([...ai.skills, ...offline.skills.filter(skill => !aiCanonical.has(normalizeArabic(canonicalSkill(skill))))], 30);
  const jobTitles = useOfflineRoles ? offline.jobTitles : ai.jobTitles;
  return {
    ...ai,
    summary: ai.summary || offline.summary,
    skills,
    experience: useOfflineRoles ? offline.experience : ai.experience,
    experienceDetails: useOfflineRoles ? offline.experienceDetails : ai.experienceDetails,
    jobTitles,
    education: ai.education.length ? ai.education : offline.education,
    certifications: ai.certifications.length ? ai.certifications : offline.certifications,
    languages: uniqueStrings([...ai.languages, ...offline.languages], 6),
    yearsExperience: useOfflineRoles ? offline.yearsExperience : ai.yearsExperience ?? offline.yearsExperience,
    careerLevel: useOfflineRoles ? offline.careerLevel : ai.careerLevel ?? offline.careerLevel,
    suggestedRoles: ai.suggestedRoles.length ? ai.suggestedRoles : offline.suggestedRoles,
    searchKeywords: uniqueStrings([...ai.searchKeywords, ...offline.searchKeywords], 16),
    projects: ai.projects.length ? ai.projects : offline.projects,
    // The ATS score is about how the file itself reads, so it comes from the offline parse; keywords from the merged reading.
    ats: offline.ats ? { ...offline.ats, keywords: uniqueStrings([...jobTitles, ...skills.filter(skill => skillGroup(skill) !== 'soft')], 20) } : null,
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
/** What the jobs agent reports back after a personalised search was requested. */
export interface JobSearchOutcome { status: 'done' | 'skipped'; reason?: string | undefined }
type AfterAnalysis = (userId: string) => Promise<JobSearchOutcome>;
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

const counted = (count: number, one: string, many: string) => `${count.toLocaleString('ar-SA')} ${count === 1 ? one : many}`;

/**
 * The workflow, each stage tracked (see pipeline.ts):
 * 1. extract the text  2. ATS reading offline (sections, roles by kind, dates, projects, skills, score)
 * 3. Claude reads it with quotes as evidence, every quote verified against the CV  4. job titles
 * 5. store and re-match every job  6. hand the profile to the jobs agent for a personalised search.
 */
async function analyse(userId: string, cvId: string) {
  const db = await getDb();
  const pipeline = await CvPipeline.start(userId, cvId);
  try {
    const [cv] = await db.select().from(cvDocuments).where(and(eq(cvDocuments.id, cvId), eq(cvDocuments.userId, userId)));
    if (!cv) throw new Error('cv_missing');
    const text = cv.extractedText ?? await extractCvText(cv.content, cv.fileName).catch(() => '');
    if (!cv.extractedText) await db.update(cvDocuments).set({ extractedText: text }).where(eq(cvDocuments.id, cvId));
    // Almost no text layer → likely a scanned image (Claude can still read the PDF itself).
    const scanned = text.replace(/\s/g, '').length < 40;
    if (scanned && !(llmAvailable() && isPdf(cv.content))) { await pipeline.stage('extract', 'failed', 'لا يوجد نص قابل للقراءة في الملف'); throw new Error('empty_text'); }
    await pipeline.stage('extract', 'done', scanned ? 'صورة ممسوحة: يقرؤها Claude من ملف PDF مباشرة' : counted(text.length, 'حرف', 'حرفًا'));

    const offline = heuristicProfile(scanned ? '' : text, new Date(), { fileName: cv.fileName, scanned });
    const kinds: Record<string, number> = {};
    for (const role of offline.experienceDetails) kinds[role.kind ?? 'job'] = (kinds[role.kind ?? 'job'] ?? 0) + 1;
    await pipeline.stage('read', 'done', [
      counted(kinds['job'] ?? 0, 'وظيفة', 'وظائف'), counted(kinds['internship'] ?? 0, 'تدريب', 'تدريبات'), counted(kinds['volunteer'] ?? 0, 'عمل تطوعي', 'أعمال تطوعية'),
      counted(offline.projects.length, 'مشروع', 'مشاريع'), counted(offline.skills.length, 'مهارة', 'مهارات'), offline.ats ? `تقييم ATS ${offline.ats.score}/100` : '',
    ].filter(Boolean).join('، '));

    let profile: CvProfileView = offline;
    if (llmAvailable()) {
      try {
        await pipeline.stage('ai', 'running');
        const ai = await claudeReading(text, cv.content, scanned);
        if (ai) {
          const verified = verifiedClaudeProfile(ai, text, new Date(), !scanned);
          profile = mergeProfiles(verified, offline);
          await pipeline.stage('ai', 'done', `اعتُمد ${counted(verified.experienceDetails.length, 'خبرة', 'خبرات')} و${counted(verified.skills.length, 'مهارة', 'مهارات')} لها دليل في السيرة، من ${counted(ai.experience.length, 'خبرة', 'خبرات')} و${counted(ai.skills.length, 'مهارة', 'مهارات')} قرأها Claude`);
        } else await pipeline.stage('ai', 'failed', 'لم يُرجع Claude قراءة صالحة؛ استُخدمت قراءة ATS المحلية');
      } catch (error) {
        console.warn('[cv-agent] Claude reading failed, using the offline reader:', describeLlmError(error));
        await pipeline.stage('ai', 'failed', `تعذّرت قراءة Claude (${describeLlmError(error)})؛ استُخدمت قراءة ATS المحلية`);
      }
    } else {
      await pipeline.stage('ai', 'skipped', 'يحتاج ANTHROPIC_API_KEY؛ استُخدمت قراءة ATS المحلية وحدها');
    }
    // Not a CV: no role, no education and hardly any skill (a stray «teamwork» in a letter is not enough).
    const hardSkills = profile.skills.filter(skill => skillGroup(skill) !== 'soft').length;
    if (!profile.experience.length && !profile.education.length && hardSkills < 2) throw new Error('nothing_found');
    await pipeline.stage('titles', profile.suggestedRoles.length ? 'done' : 'skipped', profile.suggestedRoles.join('، ') || 'لا توجد بيانات كافية لاقتراح مسميات');

    await saveProfile(userId, cvId, profile);
    await refreshMatches(db, userId);
    const [matched] = await db.select({ count: sql<number>`count(*)::int` }).from(jobMatches).where(eq(jobMatches.userId, userId));
    await pipeline.stage('match', 'done', `حُسبت نسبة التوافق لـ ${counted(matched?.count ?? 0, 'وظيفة', 'وظائف')}`);

    // Search the job sources for this CV before showing the result, so the jobs are already there.
    if (!afterAnalysis) {
      await pipeline.stage('job_search', 'skipped', 'وكيل البحث غير مسجّل');
    } else {
      await pipeline.stage('job_search', 'running', 'البحث في مصادر الوظائف بمسميات السيرة ومهاراتها');
      const search = afterAnalysis(userId)
        .then(outcome => pipeline.stage('job_search', outcome.status === 'done' ? 'done' : 'skipped', outcome.reason ?? (outcome.status === 'done' ? 'اكتمل البحث' : 'لم يُشغَّل البحث')))
        .catch(error => pipeline.stage('job_search', 'failed', describeLlmError(error)));
      // At most 40 seconds; a slower search carries on in the background and updates its stage.
      await Promise.race([search, new Promise(resolve => setTimeout(resolve, 40_000))]);
    }
    await db.update(cvDocuments).set({ status: 'analysed', analysedAt: new Date(), error: null }).where(eq(cvDocuments.id, cvId));
    await pipeline.finish('succeeded');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = reason === 'empty_text' ? 'تعذّر قراءة نص السيرة (قد تكون صورة ممسوحة). ارفع ملفًا نصيًا PDF أو Word.'
      : reason === 'nothing_found' ? 'لم نجد مهارات أو خبرات واضحة في الملف. تأكد أنه سيرة ذاتية.'
        : 'تعذّر تحليل السيرة الذاتية. حاول مرة أخرى.';
    if (reason !== 'empty_text' && reason !== 'nothing_found') console.error('[cv-agent]', error);
    await db.update(cvDocuments).set({ status: 'failed', error: message }).where(eq(cvDocuments.id, cvId));
    await pipeline.finish('failed', message).catch(() => undefined);
  }
}

async function saveProfile(userId: string, cvId: string, profile: CvProfileView) {
  const db = await getDb();
  const values = {
    cvId, summary: profile.summary, skills: profile.skills, experience: profile.experience, experienceDetails: profile.experienceDetails,
    education: profile.education, jobTitles: profile.jobTitles, languages: profile.languages, certifications: profile.certifications,
    suggestedRoles: profile.suggestedRoles, searchKeywords: profile.searchKeywords, careerLevel: profile.careerLevel,
    yearsExperience: profile.yearsExperience, projects: profile.projects, ats: profile.ats, parserVersion: PARSER_VERSION,
    engine: profile.engine, updatedAt: new Date(),
  };
  await db.insert(cvProfiles).values({ userId, ...values }).onConflictDoUpdate({ target: cvProfiles.userId, set: values });
}

/**
 * A profile analysed by an older version of the reader is re-read from the CV text already stored,
 * so existing accounts get the new format and ATS score without uploading again.
 * Claude's earlier reading is kept (only its lines are re-formatted); the offline reader is re-run.
 */
export async function upgradeStaleProfile(userId: string): Promise<boolean> {
  const db = await getDb();
  const [profile] = await db.select().from(cvProfiles).where(eq(cvProfiles.userId, userId));
  if (!profile || profile.parserVersion >= PARSER_VERSION) return false;
  const [cv] = await db.select({ text: cvDocuments.extractedText, fileName: cvDocuments.fileName }).from(cvDocuments).where(eq(cvDocuments.id, profile.cvId));
  if (!cv?.text?.trim()) return false;
  const offline = heuristicProfile(cv.text, new Date(), { fileName: cv.fileName });
  if (profile.engine === 'claude') {
    const now = new Date();
    const roles = orderRoles(profile.experienceDetails.map(detail => ({ ...detail })));
    const kept: CvProfileView = { ...profileFromRow(profile), experience: roles.map(role => formatExperience(role, now)), experienceDetails: roles.map(role => toDetail(role, now)), projects: [], ats: null };
    await saveProfile(userId, profile.cvId, mergeProfiles(kept, offline));
  } else {
    await saveProfile(userId, profile.cvId, offline);
  }
  await refreshMatches(db, userId);
  return true;
}

function profileFromRow(row: typeof cvProfiles.$inferSelect): CvProfileView {
  return {
    summary: row.summary, skills: row.skills, experience: row.experience, experienceDetails: row.experienceDetails, education: row.education, jobTitles: row.jobTitles,
    languages: row.languages, certifications: row.certifications, suggestedRoles: row.suggestedRoles, searchKeywords: row.searchKeywords, careerLevel: row.careerLevel,
    yearsExperience: row.yearsExperience, projects: row.projects ?? [], ats: row.ats ?? null, engine: row.engine === 'claude' ? 'claude' : 'heuristic',
  };
}

export const cvAgentInfo = () => ({ engine: llmAvailable() ? `claude:${env.anthropicModel}+verified+ats-reader` : 'ats-reader' });

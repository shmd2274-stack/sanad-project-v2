import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import * as z from 'zod/v4';
import { applicationSteps, type ApplicationStatus } from '@/lib/sanad-data';
import { clearSessionCookie, deleteSession, sessionCookie } from '../auth/session';
import { getDb } from '../db/client';
import { agentRuns, cvDocuments, interpreters, jobs } from '../db/schema';
import { env } from '../env';
import { cvAgentInfo, onCvAnalysed, startCvAnalysis, uploadCv } from '../agents/cv/cv-agent';
import { discoverForUser, ensureJobsScheduler, ingestPostings, PostingSchema, runJobsAgent } from '../agents/jobs/jobs-agent';
import { signCapabilities } from '../agents/interview/capabilities';
import * as interview from '../agents/interview/interview-service';
import { localVideoPath, searchSigns, textToSigns } from '../agents/interview/ssl-lexicon';
import { changePassword, logIn, signUp } from '../services/auth';
import * as candidate from '../services/candidate';
import { HttpError, readJson, requireUser, Router, type Ctx } from './core';

const router = new Router();
// A freshly analysed CV triggers a job search tailored to that candidate (background, rate-limited).
onCvAnalysed(userId => { void discoverForUser(userId).catch(error => console.warn('[jobs-agent] personal search failed', error)); });
const meta = (ctx: Ctx) => ({ ip: ctx.ip, userAgent: ctx.request.headers.get('user-agent') });
const statusSchema = z.enum(applicationSteps as [ApplicationStatus, ...ApplicationStatus[]]);

/* ───────────── Health ───────────── */
router.get('/health', async () => {
  const db = await getDb();
  const [job] = await db.select({ id: jobs.id }).from(jobs).limit(1);
  return { ok: true, database: env.databaseUrl ? 'postgres' : 'pglite', seeded: Boolean(job), claude: env.anthropicEnabled, cvAgent: cvAgentInfo(), sign: signCapabilities() };
}, 'none');

/* ───────────── Auth ───────────── */
router.post('/auth/signup', async ctx => {
  const body = await readJson(ctx, z.object({ name: z.string().max(50), email: z.string().max(255), password: z.string().max(100) }));
  const { user, session } = await signUp(body, meta(ctx));
  ctx.headers.append('set-cookie', sessionCookie(session.token, session.expiresAt));
  return { snapshot: await candidate.buildSnapshot(user) };
}, 'none');

router.post('/auth/login', async ctx => {
  const body = await readJson(ctx, z.object({ email: z.string().max(255), password: z.string().max(100) }));
  const { user, session } = await logIn(body, meta(ctx));
  ctx.headers.append('set-cookie', sessionCookie(session.token, session.expiresAt));
  return { snapshot: await candidate.buildSnapshot(user) };
}, 'none');

router.post('/auth/logout', async ctx => {
  await deleteSession(ctx.token);
  ctx.headers.append('set-cookie', clearSessionCookie());
  return { ok: true };
}, 'none');

router.post('/auth/password', async ctx => {
  const body = await readJson(ctx, z.object({ current: z.string().max(100), next: z.string().max(100) }));
  await changePassword(requireUser(ctx), body.current, body.next);
  return { ok: true };
});

/* ───────────── Me ───────────── */
router.get('/me/state', ctx => candidate.buildSnapshot(requireUser(ctx)));

router.patch('/me', async ctx => {
  const body = await readJson(ctx, z.object({ name: z.string().trim().min(1).max(50), email: z.email().max(255) }));
  await candidate.updateProfile(requireUser(ctx), body.name, body.email);
  return { ok: true };
});

router.patch('/me/settings', async ctx => {
  const body = await readJson(ctx, z.object({
    termsAccepted: z.boolean().optional(), trainingConsent: z.boolean().optional(), darkMode: z.boolean().optional(),
    selectedJobId: z.string().max(100).nullable().optional(), interpreterRequested: z.boolean().optional(),
  }).strict());
  await candidate.updateSettings(requireUser(ctx), Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)));
  return { ok: true };
});

/* ───────────── CV agent ───────────── */
router.post('/cv', async ctx => {
  const user = requireUser(ctx);
  if (Number(ctx.request.headers.get('content-length') ?? '0') > env.maxCvBytes + 64_000) throw new HttpError(413, 'too_large', 'يرجى اختيار ملف أصغر من ١٠ ميجابايت.');
  const form = await ctx.request.formData().catch(() => { throw new HttpError(400, 'invalid_form', 'تعذّر قراءة الملف.'); });
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'file_required', 'اختر ملف السيرة الذاتية.');
  return uploadCv(user, file);
});

router.post('/cv/analyse', ctx => startCvAnalysis(requireUser(ctx)));

router.get('/cv', async ctx => {
  const user = requireUser(ctx);
  const db = await getDb();
  const [cv] = await db.select({ id: cvDocuments.id, name: cvDocuments.fileName, status: cvDocuments.status, error: cvDocuments.error, createdAt: cvDocuments.createdAt })
    .from(cvDocuments).where(eq(cvDocuments.userId, user.id)).orderBy(desc(cvDocuments.createdAt)).limit(1);
  return { cv: cv ?? null };
});

/* ───────────── Jobs ───────────── */
router.get('/jobs', async ctx => ({ jobs: (await candidate.buildSnapshot(requireUser(ctx))).jobs }));

/** Ask the jobs agent to search the web for jobs that fit my CV (at most every 12 hours). */
router.post('/jobs/discover', ctx => {
  const user = requireUser(ctx);
  if (!env.anthropicEnabled) throw new HttpError(503, 'agent_unavailable', 'البحث عن الوظائف على الويب يحتاج تفعيل Claude على الخادم.');
  void discoverForUser(user.id).catch(error => console.warn('[jobs-agent] personal search failed', error));
  return { status: 'started' };
});

router.post('/applications', async ctx => {
  const body = await readJson(ctx, z.object({ jobId: z.string().max(100) }));
  await candidate.applyToJob(requireUser(ctx), body.jobId);
  return { ok: true };
});

router.post('/applications/:jobId/status', async ctx => {
  const body = await readJson(ctx, z.object({ status: statusSchema, note: z.string().max(500).optional() }));
  await candidate.setApplicationStatus(requireUser(ctx), ctx.params['jobId']!, body.status, body.note);
  return { ok: true };
});

router.put('/jobs/:jobId/schedule', async ctx => {
  const body = await readJson(ctx, z.object({ startsAt: z.string().max(40) }));
  await candidate.scheduleInterview(requireUser(ctx), ctx.params['jobId']!, body.startsAt);
  return { ok: true };
});

router.put('/jobs/:jobId/skills', async ctx => {
  const body = await readJson(ctx, z.object({ skills: z.array(z.string().max(80)).max(30) }));
  await candidate.setJobSkills(requireUser(ctx), ctx.params['jobId']!, body.skills);
  return { ok: true };
});

router.put('/jobs/:jobId/preferences', async ctx => {
  const body = await readJson(ctx, z.object({ preferences: z.array(z.string().max(40)).max(10).optional(), additionalNeeds: z.string().max(2000).optional(), planReviewed: z.boolean().optional() }));
  await candidate.setJobPreferences(requireUser(ctx), ctx.params['jobId']!, body);
  return { ok: true };
});

router.post('/training/:jobId', async ctx => {
  const body = await readJson(ctx, z.object({ questionIndex: z.number().int() }));
  await candidate.completeTrainingQuestion(requireUser(ctx), ctx.params['jobId']!, body.questionIndex);
  return { ok: true };
});

router.post('/reports', async ctx => {
  const body = await readJson(ctx, z.object({ jobId: z.string().max(100), answers: z.array(z.string().max(3000)).max(50), questions: z.array(z.string().max(1500)).max(50), durationSeconds: z.number().min(0).max(86_400), sessionId: z.string().max(100).optional() }));
  return { reportId: await candidate.createReport(requireUser(ctx), body) };
});

/* ───────────── Interview agent ───────────── */
const recruiterToken = (ctx: Ctx) => ctx.request.headers.get('x-recruiter-token') ?? ctx.url.searchParams.get('token');
const audienceOf = (ctx: Ctx, access: interview.Access): interview.Audience => access.kind === 'recruiter' || ctx.url.searchParams.get('as') === 'recruiter' ? 'recruiter' : 'candidate';

router.post('/interviews', async ctx => {
  const body = await readJson(ctx, z.object({ jobId: z.string().max(100), preview: z.boolean().default(false), communication: z.enum(['sign', 'text']).default('sign') }));
  return interview.startSession(requireUser(ctx), body);
});

router.get('/interviews/:id', async ctx => {
  const { access } = await interview.authorize(ctx.params['id']!, ctx.user, recruiterToken(ctx));
  return interview.sessionState(ctx.params['id']!, audienceOf(ctx, access));
}, 'none');

router.get('/interviews/:id/events', async ctx => {
  const { access } = await interview.authorize(ctx.params['id']!, ctx.user, recruiterToken(ctx));
  const after = Number(ctx.url.searchParams.get('after') ?? '0') || 0;
  const wait = Number(ctx.url.searchParams.get('wait') ?? '0') || 0;
  return { events: await interview.listEvents(ctx.params['id']!, audienceOf(ctx, access), after, wait) };
}, 'none');

router.post('/interviews/:id/questions', async ctx => {
  const { access } = await interview.authorize(ctx.params['id']!, ctx.user, recruiterToken(ctx));
  const body = await readJson(ctx, z.object({ text: z.string().max(1500), simple: z.string().max(1500).optional() }));
  return interview.askQuestion(ctx.params['id']!, access, body);
}, 'none');

router.post('/interviews/:id/answers/recognize', async ctx => {
  const { access } = await interview.authorize(ctx.params['id']!, ctx.user, null);
  if (access.kind !== 'owner') throw new HttpError(403, 'forbidden', 'للمرشح فقط.');
  const body = await readJson(ctx, z.object({ questionId: z.string().max(100), frames: z.array(z.string().max(400_000)).max(48) }), 16_000_000);
  return interview.recognizeAnswer(ctx.params['id']!, body);
}, 'none');

router.post('/interviews/:id/answers/text', async ctx => {
  const { access } = await interview.authorize(ctx.params['id']!, ctx.user, null);
  if (access.kind !== 'owner') throw new HttpError(403, 'forbidden', 'للمرشح فقط.');
  return interview.draftTypedAnswer(ctx.params['id']!, await readJson(ctx, z.object({ questionId: z.string().max(100), text: z.string().max(3000) })));
}, 'none');

router.post('/interviews/:id/answers/:answerId/decision', async ctx => {
  const { access } = await interview.authorize(ctx.params['id']!, ctx.user, null);
  if (access.kind !== 'owner') throw new HttpError(403, 'forbidden', 'المرشح وحده يعتمد إجابته.');
  const body = await readJson(ctx, z.object({ approved: z.boolean(), text: z.string().max(3000).optional() }));
  return interview.decideAnswer(ctx.params['id']!, ctx.params['answerId']!, body);
}, 'none');

router.post('/interviews/:id/interpreter', async ctx => {
  const { access } = await interview.authorize(ctx.params['id']!, ctx.user, recruiterToken(ctx));
  return interview.joinInterpreter(ctx.params['id']!, access.kind === 'owner' ? 'candidate' : 'recruiter');
}, 'none');

router.post('/interviews/:id/reactions', async ctx => {
  const { access } = await interview.authorize(ctx.params['id']!, ctx.user, recruiterToken(ctx));
  const body = await readJson(ctx, z.object({ reactionId: z.string().max(20), sender: z.enum(['candidate', 'recruiter']) }));
  return interview.sendReaction(ctx.params['id']!, { reactionId: body.reactionId, sender: access.kind === 'recruiter' ? 'recruiter' : body.sender });
}, 'none');

router.post('/interviews/:id/end', async ctx => {
  const body = await readJson(ctx, z.object({ durationSeconds: z.number().min(0).max(86_400) }));
  return interview.endSession(ctx.params['id']!, requireUser(ctx), body.durationSeconds);
});

/* ───────────── Saudi Sign Language ───────────── */
router.get('/ssl/search', ctx => ({ results: searchSigns(ctx.url.searchParams.get('q') ?? '', 30) }), 'none');
router.get('/ssl/translate', ctx => ({ playlist: textToSigns((ctx.url.searchParams.get('text') ?? '').slice(0, 500)) }), 'none');

router.get('/ssl/videos/:videoId', async ctx => {
  const file = localVideoPath(ctx.params['videoId'] ?? '');
  if (!file) throw new HttpError(404, 'video_not_found', 'الفيديو غير متوفر محليًا.');
  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(ctx.request.headers.get('range') ?? '');
  const headers = new Headers({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=604800, immutable' });
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(fs.createReadStream(file, { start, end }) as unknown as ReadableStream, { status: 206, headers });
  }
  headers.set('content-length', String(size));
  return new Response(fs.createReadStream(file) as unknown as ReadableStream, { status: 200, headers });
}, 'none');

/* ───────────── Admin: agents & interpreters ───────────── */
router.post('/admin/agents/jobs/run', () => runJobsAgent('manual'), 'admin');
router.get('/admin/agents/runs', async () => {
  const db = await getDb();
  return { runs: await db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(20) };
}, 'admin');
router.post('/admin/jobs', async ctx => {
  const body = await readJson(ctx, z.object({ jobs: z.array(PostingSchema).max(200) }));
  return ingestPostings(body.jobs, 'employer');
}, 'admin');
router.post('/admin/interpreters', async ctx => {
  const body = await readJson(ctx, z.object({ name: z.string().min(1).max(100), email: z.email().optional(), phone: z.string().max(30).optional(), meetingUrl: z.url().optional() }));
  const db = await getDb();
  const id = randomUUID();
  await db.insert(interpreters).values({ id, name: body.name, email: body.email ?? null, phone: body.phone ?? null, meetingUrl: body.meetingUrl ?? null });
  return { id };
}, 'admin');

export async function handleApiRequest(request: Request): Promise<Response> {
  ensureJobsScheduler();
  return router.handle(request);
}

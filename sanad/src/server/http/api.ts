import { and, desc, eq } from 'drizzle-orm';
import * as z from 'zod/v4';
import { applicationSteps, type ApplicationStatus } from '@/lib/sanad-data';
import { clearSessionCookie, deleteSession, sessionCookie } from '../auth/session';
import { getDb } from '../db/client';
import { agentRuns, cvDocuments, cvProfiles, jobs } from '../db/schema';
import { env } from '../env';
import { cvAgentInfo, onCvAnalysed, startCvAnalysis, upgradeStaleProfile, uploadCv } from '../agents/cv/cv-agent';
import { discoverForUser, discoverFromSources, ensureJobsScheduler, ingestPostings, PostingSchema, runJobsAgent, SOURCES } from '../agents/jobs/jobs-agent';
import { llmAvailable } from '../agents/llm';
import { changePassword, logIn, signUp } from '../services/auth';
import * as candidate from '../services/candidate';
import { HttpError, readJson, requireUser, Router, type Ctx } from './core';

const router = new Router();
// A freshly analysed CV triggers a job search tailored to that candidate (background, rate-limited).
// A freshly analysed CV: search the live job sources for it now; with a Claude key the web agent also searches in the background.
onCvAnalysed(async userId => {
  if (llmAvailable()) void discoverForUser(userId).catch(error => console.warn('[jobs-agent] personal search failed', error));
  return discoverFromSources(userId, { force: true });
});
const meta = (ctx: Ctx) => ({ ip: ctx.ip, userAgent: ctx.request.headers.get('user-agent') });
const statusSchema = z.enum(applicationSteps as [ApplicationStatus, ...ApplicationStatus[]]);

/* ───────────── Health ───────────── */
router.get('/health', async () => {
  const db = await getDb();
  const [job] = await db.select({ id: jobs.id }).from(jobs).limit(1);
  return { ok: true, database: env.databaseUrl ? 'postgres' : 'pglite', seeded: Boolean(job), claude: env.anthropicEnabled, cvAgent: cvAgentInfo() };
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

/** Where my CV is in the workflow: each stage of the analysis, and the latest personalised job search with its sources. */
router.get('/pipeline', async ctx => {
  const user = requireUser(ctx);
  const db = await getDb();
  const [cv] = await db.select({ name: cvDocuments.fileName, status: cvDocuments.status, error: cvDocuments.error }).from(cvDocuments).where(eq(cvDocuments.userId, user.id)).orderBy(desc(cvDocuments.createdAt)).limit(1);
  const latest = (agent: string) => db.select().from(agentRuns).where(and(eq(agentRuns.agent, agent), eq(agentRuns.userId, user.id))).orderBy(desc(agentRuns.startedAt)).limit(1);
  const [analysis] = await latest('cv');
  const [search] = await latest('jobs-personal');
  const [direct] = await latest('jobs-sources');
  return {
    cv: cv ?? null,
    analysis: analysis ? { status: analysis.status, startedAt: analysis.startedAt, finishedAt: analysis.finishedAt, error: analysis.error, stages: analysis.stats['stages'] ?? [] } : null,
    sourceSearch: direct ? { status: direct.status, startedAt: direct.startedAt, finishedAt: direct.finishedAt, error: direct.error, queries: direct.stats['queries'] ?? [], fetched: direct.stats['fetched'], kept: direct.stats['kept'], created: direct.stats['created'], sources: direct.stats['sources'] ?? [] } : null,
    jobSearch: search ? { status: search.status, startedAt: search.startedAt, finishedAt: search.finishedAt, error: search.error, saved: search.stats['saved'], duplicates: search.stats['duplicates'], rejected: search.stats['rejected'], sources: search.stats['sources'] ?? [] } : null,
    webSearchEnabled: env.anthropicEnabled,
    sources: SOURCES,
  };
});

/** The full ATS reading: score, every check with its tip, parsed fields and keywords. */
router.get('/cv/ats', async ctx => {
  const user = requireUser(ctx);
  await upgradeStaleProfile(user.id);
  const db = await getDb();
  const [profile] = await db.select().from(cvProfiles).where(eq(cvProfiles.userId, user.id));
  if (!profile) throw new HttpError(404, 'cv_not_analysed', 'حلّل سيرتك الذاتية أولًا.');
  const view = candidate.profileView(profile);
  return { ats: view.ats, profile: { ...view, ats: undefined } };
});

/* ───────────── Jobs ───────────── */
router.get('/jobs', async ctx => ({ jobs: (await candidate.buildSnapshot(requireUser(ctx))).jobs }));

/** Search the job sources for jobs that fit my CV now (at most every 6 hours; the web agent too when Claude is on). */
router.post('/jobs/discover', async ctx => {
  const user = requireUser(ctx);
  if (env.anthropicEnabled) void discoverForUser(user.id).catch(error => console.warn('[jobs-agent] personal search failed', error));
  return discoverFromSources(user.id);
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
  const body = await readJson(ctx, z.object({ jobId: z.string().max(100), answers: z.array(z.string().max(3000)).max(50), questions: z.array(z.string().max(1500)).max(50), durationSeconds: z.number().min(0).max(86_400) }));
  return { reportId: await candidate.createReport(requireUser(ctx), body) };
});

/* ───────────── Admin: agents ───────────── */
router.post('/admin/agents/jobs/run', () => runJobsAgent('manual'), 'admin');
router.get('/admin/agents/runs', async () => {
  const db = await getDb();
  return { runs: await db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(20) };
}, 'admin');
router.post('/admin/jobs', async ctx => {
  const body = await readJson(ctx, z.object({ jobs: z.array(PostingSchema).max(200) }));
  return ingestPostings(body.jobs, 'employer');
}, 'admin');

export async function handleApiRequest(request: Request): Promise<Response> {
  ensureJobsScheduler();
  return router.handle(request);
}

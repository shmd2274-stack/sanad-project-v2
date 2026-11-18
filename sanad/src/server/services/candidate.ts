import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { canUpdateApplication, coachQuestions, communicationPreferences, riyadhDay, scheduleConflict, type ApplicationStatus, type CvStatus, type InterviewReport, type Job } from '@/lib/sanad-data';
import type { CvProfileView, SanadSnapshot } from '@/lib/sanad-snapshot';
import type { AuthUser } from '../auth/session';
import { getDb, type Db } from '../db/client';
import * as t from '../db/schema';
import { env } from '../env';
import { HttpError } from '../http/core';
import { matchJob } from '../agents/jobs/matching';

const iso = (value: Date | null | undefined) => value ? value.toISOString() : undefined;
const MAX_JOBS_IN_SNAPSHOT = 60;

export function profileView(row: typeof t.cvProfiles.$inferSelect): CvProfileView {
  return {
    summary: row.summary, skills: row.skills, experience: row.experience, experienceDetails: row.experienceDetails, education: row.education, jobTitles: row.jobTitles,
    languages: row.languages, certifications: row.certifications, suggestedRoles: row.suggestedRoles, searchKeywords: row.searchKeywords,
    careerLevel: row.careerLevel, yearsExperience: row.yearsExperience, projects: row.projects ?? [], ats: row.ats ?? null,
    engine: row.engine === 'claude' ? 'claude' : 'heuristic',
  };
}

export function jobView(row: typeof t.jobs.$inferSelect, match?: { score: number; reason: string }): Job {
  return {
    id: row.id, title: row.title, english: row.english, company: row.company, mark: row.mark || row.company.slice(0, 1),
    match: match?.score ?? 0, location: row.location, mode: row.mode, salary: row.salary, description: row.description,
    skills: row.skills, tone: row.tone, matchReason: match?.reason, source: row.source, sourceName: row.sourceName ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined, postedAt: iso(row.postedAt), deadline: iso(row.deadline), deafFriendlyReason: row.deafFriendlyReason ?? undefined,
  };
}

export async function ensureSettings(db: Db, userId: string) {
  const [row] = await db.select().from(t.userSettings).where(eq(t.userSettings.userId, userId));
  if (row) return row;
  const [created] = await db.insert(t.userSettings).values({ userId }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(t.userSettings).where(eq(t.userSettings.userId, userId)))[0]!;
}

export async function requireJob(db: Db, jobId: string) {
  const [job] = await db.select().from(t.jobs).where(eq(t.jobs.id, jobId));
  if (!job) throw new HttpError(404, 'job_not_found', 'الوظيفة غير موجودة.');
  return job;
}

/** Recomputes match scores for one user against the given jobs (all active jobs by default). */
export async function refreshMatches(db: Db, userId: string, jobIds?: string[]) {
  const [profile] = await db.select().from(t.cvProfiles).where(eq(t.cvProfiles.userId, userId));
  if (!profile) return;
  const rows = await db.select().from(t.jobs).where(jobIds?.length ? inArray(t.jobs.id, jobIds) : and(eq(t.jobs.status, 'active'), ne(t.jobs.source, 'sanad')));
  const view = profileView(profile);
  // Like an ATS, look for each job keyword in the whole CV text, not only in the extracted skills.
  const [cv] = await db.select({ text: t.cvDocuments.extractedText }).from(t.cvDocuments).where(eq(t.cvDocuments.id, profile.cvId));
  for (const job of rows) {
    const result = matchJob(view, job, cv?.text ?? '');
    const values = { score: result.score, reason: result.reason, matchedSkills: result.matchedSkills, missingSkills: result.missingSkills, updatedAt: new Date() };
    await db.insert(t.jobMatches).values({ userId, jobId: job.id, ...values })
      .onConflictDoUpdate({ target: [t.jobMatches.userId, t.jobMatches.jobId], set: values });
  }
}

export async function buildSnapshot(user: AuthUser): Promise<SanadSnapshot> {
  const db = await getDb();
  // Profiles read by an older version of the CV reader are re-read from the stored text first.
  const { upgradeStaleProfile } = await import('../agents/cv/cv-agent');
  await upgradeStaleProfile(user.id);
  // Keep this account's jobs fresh: a background search of the job sources (at most every 6 hours).
  (await import('../agents/jobs/jobs-agent')).refreshJobsInBackground(user.id);
  const settings = await ensureSettings(db, user.id);
  const [cv] = await db.select({ name: t.cvDocuments.fileName, status: t.cvDocuments.status, createdAt: t.cvDocuments.createdAt, error: t.cvDocuments.error })
    .from(t.cvDocuments).where(eq(t.cvDocuments.userId, user.id)).orderBy(desc(t.cvDocuments.createdAt)).limit(1);
  const [profile] = await db.select().from(t.cvProfiles).where(eq(t.cvProfiles.userId, user.id));
  const appRows = await db.select().from(t.applications).where(eq(t.applications.userId, user.id));
  const appliedIds = appRows.map(row => row.jobId);

  // Jobs: every real active posting (found by the jobs agent, feeds or employers), plus jobs the
  // candidate already applied to (even if since expired). The built-in demo jobs are for the guest
  // demo only and are never shown to an account as real results.
  const realActive = and(eq(t.jobs.status, 'active'), ne(t.jobs.source, 'sanad'));
  const jobRows = await db.select().from(t.jobs).where(appliedIds.length ? or(realActive, inArray(t.jobs.id, appliedIds)) : realActive);
  let matchRows = await db.select().from(t.jobMatches).where(eq(t.jobMatches.userId, user.id));
  if (profile && jobRows.some(job => !matchRows.some(match => match.jobId === job.id))) {
    await refreshMatches(db, user.id, jobRows.filter(job => !matchRows.some(match => match.jobId === job.id)).map(job => job.id));
    matchRows = await db.select().from(t.jobMatches).where(eq(t.jobMatches.userId, user.id));
  }
  const matches = new Map(matchRows.map(row => [row.jobId, row]));
  const jobs = jobRows
    .map(row => jobView(row, matches.get(row.id)))
    .sort((a, b) => Number(appliedIds.includes(b.id)) - Number(appliedIds.includes(a.id)) || b.match - a.match || (a.source === 'sanad' ? -1 : 0) - (b.source === 'sanad' ? -1 : 0) || (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
    .slice(0, Math.max(MAX_JOBS_IN_SNAPSHOT, appliedIds.length));

  const events = await db.select().from(t.applicationEvents).where(eq(t.applicationEvents.userId, user.id)).orderBy(asc(t.applicationEvents.id));
  const scheduleRows = await db.select().from(t.interviewSchedules).where(eq(t.interviewSchedules.userId, user.id));
  const overrides = await db.select().from(t.jobSkillOverrides).where(eq(t.jobSkillOverrides.userId, user.id));
  const prefs = await db.select().from(t.jobPreferences).where(eq(t.jobPreferences.userId, user.id));
  const training = await db.select().from(t.trainingProgress).where(eq(t.trainingProgress.userId, user.id));
  const reportRows = await db.select().from(t.reports).where(eq(t.reports.userId, user.id)).orderBy(desc(t.reports.createdAt));

  const applicationHistory: SanadSnapshot['applicationHistory'] = {};
  for (const event of events) (applicationHistory[event.jobId] ??= []).push({ status: event.status as ApplicationStatus, date: event.createdAt.toISOString() });

  const cvStatus: SanadSnapshot['cv'] = cv ? { name: cv.name, status: cv.status as CvStatus | 'failed', uploadedAt: cv.createdAt.toISOString(), error: cv.error } : null;
  const reports: InterviewReport[] = reportRows.map(row => ({ id: row.id, jobId: row.jobId, date: row.createdAt.toISOString(), answers: row.answers, questions: row.questions, durationSeconds: row.durationSeconds }));

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    settings: { termsAccepted: settings.termsAccepted, trainingConsent: settings.trainingConsent, darkMode: settings.darkMode, selectedJobId: settings.selectedJobId, interpreterRequested: settings.interpreterRequested },
    cv: cvStatus,
    cvProfile: profile ? profileView(profile) : null,
    jobs,
    applications: Object.fromEntries(appRows.map(row => [row.jobId, row.status as ApplicationStatus])),
    applicationDates: Object.fromEntries(appRows.filter(row => row.appliedAt).map(row => [row.jobId, row.appliedAt!.toISOString()])),
    applicationHistory,
    schedules: Object.fromEntries(scheduleRows.map(row => [row.jobId, row.startsAt.toISOString()])),
    jobSkills: Object.fromEntries(overrides.map(row => [row.jobId, row.skills])),
    preferences: Object.fromEntries(prefs.map(row => [row.jobId, row.preferences])),
    additionalCommunicationNeeds: Object.fromEntries(prefs.filter(row => row.additionalNeeds).map(row => [row.jobId, row.additionalNeeds])),
    reviewedPlans: prefs.filter(row => row.planReviewedAt).map(row => row.jobId),
    trainingProgress: Object.fromEntries(training.map(row => [row.jobId, row.completed])),
    reports,
    capabilities: { claude: env.anthropicEnabled },
  };
}

/* ───────────── Profile & settings ───────────── */

export async function updateProfile(user: AuthUser, name: string, email: string) {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const [taken] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, normalized));
  if (taken && taken.id !== user.id) throw new HttpError(409, 'email_taken', 'هذا البريد مستخدم في حساب آخر.');
  await db.update(t.users).set({ name: name.trim(), email: normalized, updatedAt: new Date() }).where(eq(t.users.id, user.id));
}

export async function updateSettings(user: AuthUser, patch: Partial<{ termsAccepted: boolean; trainingConsent: boolean; darkMode: boolean; selectedJobId: string | null; interpreterRequested: boolean }>) {
  const db = await getDb();
  await ensureSettings(db, user.id);
  if (patch.selectedJobId) await requireJob(db, patch.selectedJobId);
  const now = new Date();
  await db.update(t.userSettings).set({
    ...patch,
    ...(patch.termsAccepted !== undefined ? { termsAcceptedAt: patch.termsAccepted ? now : null } : {}),
    ...(patch.trainingConsent !== undefined ? { trainingConsentAt: patch.trainingConsent ? now : null } : {}),
    updatedAt: now,
  }).where(eq(t.userSettings.userId, user.id));
}

/* ───────────── Applications & timeline ───────────── */

async function currentStatus(db: Db, userId: string, jobId: string): Promise<ApplicationStatus> {
  const [row] = await db.select({ status: t.applications.status }).from(t.applications).where(and(eq(t.applications.userId, userId), eq(t.applications.jobId, jobId)));
  return (row?.status as ApplicationStatus | undefined) ?? 'available';
}

async function writeStatus(db: Db, userId: string, jobId: string, status: ApplicationStatus, note?: string) {
  const now = new Date();
  await db.insert(t.applications).values({ userId, jobId, status, appliedAt: status === 'applied' ? now : null, updatedAt: now })
    .onConflictDoUpdate({ target: [t.applications.userId, t.applications.jobId], set: { status, updatedAt: now, ...(status === 'applied' ? { appliedAt: now } : {}) } });
  await db.insert(t.applicationEvents).values({ userId, jobId, status, note: note ?? null, createdAt: now });
}

const CANDIDATE_TRANSITIONS: ApplicationStatus[] = ['withdrawn', 'nominated', 'completed'];

export async function setApplicationStatus(user: AuthUser, jobId: string, next: ApplicationStatus, note?: string) {
  const db = await getDb();
  await requireJob(db, jobId);
  const current = await currentStatus(db, user.id, jobId);
  if (!canUpdateApplication(current, next)) throw new HttpError(409, 'invalid_transition', 'لا يمكن نقل الطلب إلى هذه المرحلة الآن.');
  const employerSide = user.role === 'employer' || user.role === 'admin';
  if (!employerSide && next !== 'applied' && !CANDIDATE_TRANSITIONS.includes(next)) throw new HttpError(403, 'employer_only', 'هذه المرحلة تحددها جهة التوظيف.');
  await writeStatus(db, user.id, jobId, next, note);
  if (next === 'nominated') await ensureInterviewScheduled(db, user.id, jobId);
}

export async function applyToJob(user: AuthUser, jobId: string) {
  const db = await getDb();
  const job = await requireJob(db, jobId);
  if (job.status !== 'active') throw new HttpError(409, 'job_closed', 'انتهى التقديم على هذه الوظيفة.');
  const [profile] = await db.select({ userId: t.cvProfiles.userId }).from(t.cvProfiles).where(eq(t.cvProfiles.userId, user.id));
  if (!profile) throw new HttpError(409, 'cv_required', 'أكمل تحليل سيرتك الذاتية قبل التقديم.');
  if ((await currentStatus(db, user.id, jobId)) !== 'available') throw new HttpError(409, 'already_applied', 'سبق أن قدّمت على هذه الوظيفة.');
  await writeStatus(db, user.id, jobId, 'applied');
  await updateSettings(user, { selectedJobId: jobId });
}

/** Default interview slot: two days later, 10:00 Riyadh, skipping days that already have an interview. */
async function ensureInterviewScheduled(db: Db, userId: string, jobId: string) {
  const existing = await db.select().from(t.interviewSchedules).where(eq(t.interviewSchedules.userId, userId));
  if (existing.some(row => row.jobId === jobId)) return;
  const others = Object.fromEntries(existing.map(row => [row.jobId, row.startsAt.toISOString()]));
  for (let offset = 2; offset < 60; offset += 1) {
    const day = riyadhDay(new Date(Date.now() + offset * 86_400_000).toISOString());
    const candidate = `${day}T10:00:00+03:00`;
    if (!scheduleConflict(jobId, candidate, others)) {
      await db.insert(t.interviewSchedules).values({ userId, jobId, startsAt: new Date(candidate) }).onConflictDoNothing();
      return;
    }
  }
}

export async function scheduleInterview(user: AuthUser, jobId: string, startsAt: string) {
  const db = await getDb();
  await requireJob(db, jobId);
  if (!Number.isFinite(Date.parse(startsAt))) throw new HttpError(400, 'invalid_date', 'اختر موعدًا صحيحًا.');
  const rows = await db.select().from(t.interviewSchedules).where(eq(t.interviewSchedules.userId, user.id));
  const conflict = scheduleConflict(jobId, startsAt, Object.fromEntries(rows.map(row => [row.jobId, row.startsAt.toISOString()])));
  if (conflict) throw new HttpError(409, 'schedule_conflict', conflict);
  await db.insert(t.interviewSchedules).values({ userId: user.id, jobId, startsAt: new Date(startsAt) })
    .onConflictDoUpdate({ target: [t.interviewSchedules.userId, t.interviewSchedules.jobId], set: { startsAt: new Date(startsAt), updatedAt: new Date() } });
  // Timeline entry so the tracker shows when the appointment changed.
  const status = await currentStatus(db, user.id, jobId);
  if (status !== 'available') await db.insert(t.applicationEvents).values({ userId: user.id, jobId, status, note: `schedule:${startsAt}` });
}

export async function setJobSkills(user: AuthUser, jobId: string, skills: string[]) {
  const db = await getDb();
  await requireJob(db, jobId);
  const clean = [...new Set(skills.map(skill => skill.trim()).filter(Boolean))].slice(0, 30);
  if (!clean.length) throw new HttpError(400, 'skills_required', 'أضف مهارة واحدة على الأقل.');
  await db.insert(t.jobSkillOverrides).values({ userId: user.id, jobId, skills: clean })
    .onConflictDoUpdate({ target: [t.jobSkillOverrides.userId, t.jobSkillOverrides.jobId], set: { skills: clean, updatedAt: new Date() } });
}

export async function setJobPreferences(user: AuthUser, jobId: string, patch: { preferences?: string[] | undefined; additionalNeeds?: string | undefined; planReviewed?: boolean | undefined }) {
  const db = await getDb();
  await requireJob(db, jobId);
  const allowed = new Set<string>(communicationPreferences.map(item => item.id));
  const values: Partial<typeof t.jobPreferences.$inferInsert> = { updatedAt: new Date() };
  if (patch.preferences) values.preferences = [...new Set(patch.preferences.filter(item => allowed.has(item)))];
  if (patch.additionalNeeds !== undefined) values.additionalNeeds = patch.additionalNeeds.slice(0, 2000);
  if (patch.planReviewed) values.planReviewedAt = new Date();
  await db.insert(t.jobPreferences).values({ userId: user.id, jobId, ...values })
    .onConflictDoUpdate({ target: [t.jobPreferences.userId, t.jobPreferences.jobId], set: values });
}

export async function completeTrainingQuestion(user: AuthUser, jobId: string, questionIndex: number) {
  const db = await getDb();
  await requireJob(db, jobId);
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= coachQuestions.length) throw new HttpError(400, 'invalid_question', 'سؤال غير صالح.');
  const [row] = await db.select().from(t.trainingProgress).where(and(eq(t.trainingProgress.userId, user.id), eq(t.trainingProgress.jobId, jobId)));
  const completed = [...new Set([...(row?.completed ?? []), questionIndex])].sort((a, b) => a - b);
  await db.insert(t.trainingProgress).values({ userId: user.id, jobId, completed })
    .onConflictDoUpdate({ target: [t.trainingProgress.userId, t.trainingProgress.jobId], set: { completed, updatedAt: new Date() } });
}

/** Saves the interview report. Only answers the candidate approved are stored. */
export async function createReport(user: AuthUser, input: { jobId: string; answers: string[]; questions: string[]; durationSeconds: number }) {
  const db = await getDb();
  await requireJob(db, input.jobId);
  const status = await currentStatus(db, user.id, input.jobId);
  if (!['nominated', 'scheduled'].includes(status)) throw new HttpError(409, 'not_nominated', 'لا توجد مقابلة مفتوحة لهذه الوظيفة.');
  const answers = input.answers.map(answer => answer.trim()).filter(Boolean).slice(0, 50);
  const questions = input.questions.slice(0, 50);
  const id = `report-${randomUUID()}`;
  await db.insert(t.reports).values({ id, userId: user.id, jobId: input.jobId, answers, questions, durationSeconds: Math.max(0, Math.round(input.durationSeconds)) });
  await writeStatus(db, user.id, input.jobId, 'completed');
  return id;
}

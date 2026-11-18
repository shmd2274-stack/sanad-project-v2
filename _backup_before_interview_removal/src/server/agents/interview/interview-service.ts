import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, max } from 'drizzle-orm';
import { canOpenInterview, reactions, type ApplicationStatus } from '@/lib/sanad-data';
import type { AuthUser } from '../../auth/session';
import { getDb } from '../../db/client';
import * as t from '../../db/schema';
import { HttpError } from '../../http/core';
import { createReport, requireJob } from '../../services/candidate';
import { CONFIDENCE_FLOOR, recognizeSigning } from './recognition';
import { simplifyQuestion } from './simplify';
import { textToSigns } from './ssl-lexicon';

/** After this many misunderstandings in a row the backup interpreter joins automatically. */
export const AUTO_INTERPRETER_AFTER = 2;

export type Audience = 'candidate' | 'recruiter';
export interface Actor { kind: 'owner'; user: AuthUser }
export type Access = { kind: 'owner'; user: AuthUser } | { kind: 'recruiter' };

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function emit(sessionId: string, type: string, payload: Record<string, unknown>, audience: 'all' | Audience = 'all') {
  const db = await getDb();
  await db.insert(t.interviewEvents).values({ sessionId, type, payload, audience });
}

async function loadSession(sessionId: string) {
  const db = await getDb();
  const [session] = await db.select().from(t.interviewSessions).where(eq(t.interviewSessions.id, sessionId));
  if (!session) throw new HttpError(404, 'session_not_found', 'جلسة المقابلة غير موجودة.');
  return session;
}

/** Owner = the candidate's account. Recruiter = anyone holding the session's recruiter link token. */
export async function authorize(sessionId: string, user: AuthUser | null, recruiterToken: string | null): Promise<{ session: typeof t.interviewSessions.$inferSelect; access: Access }> {
  const session = await loadSession(sessionId);
  if (user && session.userId === user.id) return { session, access: { kind: 'owner', user } };
  if (recruiterToken) {
    const expected = Buffer.from(session.recruiterTokenHash, 'hex');
    const actual = Buffer.from(hash(recruiterToken), 'hex');
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return { session, access: { kind: 'recruiter' } };
  }
  throw new HttpError(403, 'forbidden', 'لا تملك صلاحية الدخول إلى هذه المقابلة.');
}

function assertLive(session: typeof t.interviewSessions.$inferSelect) {
  if (session.status !== 'live') throw new HttpError(409, 'session_ended', 'انتهت المقابلة.');
}

async function reserveInterpreter() {
  const db = await getDb();
  const [interpreter] = await db.select().from(t.interpreters).where(eq(t.interpreters.active, true)).orderBy(asc(t.interpreters.createdAt)).limit(1);
  return interpreter ?? null;
}

export async function startSession(user: AuthUser, input: { jobId: string; preview: boolean; communication: 'sign' | 'text' }) {
  const db = await getDb();
  const job = await requireJob(db, input.jobId);
  if (!input.preview) {
    const [application] = await db.select().from(t.applications).where(and(eq(t.applications.userId, user.id), eq(t.applications.jobId, job.id)));
    const [schedule] = await db.select().from(t.interviewSchedules).where(and(eq(t.interviewSchedules.userId, user.id), eq(t.interviewSchedules.jobId, job.id)));
    if (!canOpenInterview((application?.status ?? 'available') as ApplicationStatus, schedule?.startsAt.toISOString(), Date.now(), false)) {
      throw new HttpError(409, 'interview_not_open', 'يتاح الدخول بعد الترشيح وعند حلول موعد المقابلة.');
    }
  }
  const recruiterToken = randomBytes(24).toString('base64url');
  const interpreter = await reserveInterpreter();
  const id = randomUUID();
  await db.insert(t.interviewSessions).values({
    id, userId: user.id, jobId: job.id, preview: input.preview, communication: input.communication, recruiterTokenHash: hash(recruiterToken),
    // A backup interpreter is reserved automatically for every interview and stays on standby.
    interpreterStatus: 'standby', interpreterId: interpreter?.id ?? null,
  });
  await emit(id, 'session_started', { jobId: job.id, preview: input.preview, communication: input.communication, interpreter: interpreter ? { name: interpreter.name } : null });
  return { sessionId: id, recruiterToken, interpreter: interpreter ? { name: interpreter.name, status: 'standby' } : { name: null, status: 'standby' } };
}

export async function askQuestion(sessionId: string, access: Access, input: { text: string; simple?: string | undefined }) {
  const session = await loadSession(sessionId);
  assertLive(session);
  const db = await getDb();
  const job = await requireJob(db, session.jobId);
  const original = input.text.trim().slice(0, 1500);
  if (!original) throw new HttpError(400, 'empty_question', 'اكتب السؤال.');
  const simplified = input.simple?.trim() ? { simple: input.simple.trim(), glosses: [] as string[], engine: 'catalog' as const } : await simplifyQuestion(original, { jobTitle: job.title });
  const playlist = textToSigns(simplified.simple, simplified.glosses);
  const [last] = await db.select({ seq: max(t.interviewQuestions.seq) }).from(t.interviewQuestions).where(eq(t.interviewQuestions.sessionId, sessionId));
  const question = { id: randomUUID(), sessionId, seq: (last?.seq ?? 0) + 1, original, simple: simplified.simple, signPlaylist: playlist, engine: simplified.engine };
  await db.insert(t.interviewQuestions).values(question);
  await emit(sessionId, 'question', { id: question.id, seq: question.seq, original, simple: question.simple, playlist, by: access.kind });
  return { id: question.id, seq: question.seq, original, simple: question.simple, playlist, engine: simplified.engine };
}

async function requireQuestion(sessionId: string, questionId: string) {
  const db = await getDb();
  const [question] = await db.select().from(t.interviewQuestions).where(and(eq(t.interviewQuestions.id, questionId), eq(t.interviewQuestions.sessionId, sessionId)));
  if (!question) throw new HttpError(404, 'question_not_found', 'السؤال غير موجود.');
  return question;
}

async function registerMisunderstanding(sessionId: string, reason: string) {
  const db = await getDb();
  const session = await loadSession(sessionId);
  const consecutive = session.consecutiveMisunderstandings + 1;
  await db.update(t.interviewSessions).set({ misunderstandings: session.misunderstandings + 1, consecutiveMisunderstandings: consecutive }).where(eq(t.interviewSessions.id, sessionId));
  await emit(sessionId, 'misunderstanding', { count: consecutive, reason });
  if (consecutive >= AUTO_INTERPRETER_AFTER && session.interpreterStatus !== 'joined') await joinInterpreter(sessionId, 'auto');
  return consecutive;
}

export async function joinInterpreter(sessionId: string, reason: 'auto' | 'candidate' | 'recruiter') {
  const db = await getDb();
  const session = await loadSession(sessionId);
  if (session.interpreterStatus === 'joined') return { status: 'joined' as const };
  const interpreter = session.interpreterId ? (await db.select().from(t.interpreters).where(eq(t.interpreters.id, session.interpreterId)))[0] : await reserveInterpreter();
  await db.update(t.interviewSessions).set({ interpreterStatus: 'joined', interpreterId: interpreter?.id ?? null, interpreterReason: reason }).where(eq(t.interviewSessions.id, sessionId));
  await emit(sessionId, 'interpreter_joined', { reason, interpreter: interpreter ? { name: interpreter.name, meetingUrl: interpreter.meetingUrl } : null });
  if (session.userId) {
    await db.update(t.userSettings).set({ interpreterRequested: true, updatedAt: new Date() }).where(eq(t.userSettings.userId, session.userId));
  }
  return { status: 'joined' as const, interpreter: interpreter ? { name: interpreter.name, meetingUrl: interpreter.meetingUrl } : null };
}

/** Candidate signed an answer: recognise it with the question as context and return a draft for 👍/👎. */
export async function recognizeAnswer(sessionId: string, input: { questionId: string; frames: string[] }) {
  const session = await loadSession(sessionId);
  assertLive(session);
  const question = await requireQuestion(sessionId, input.questionId);
  const db = await getDb();
  const job = await requireJob(db, session.jobId);
  const frames = input.frames.map(frame => frame.replace(/^data:image\/\w+;base64,/, ''));
  const result = await recognizeSigning(frames, { original: question.original, simple: question.simple, jobTitle: job.title });
  const id = randomUUID();
  await db.insert(t.interviewAnswers).values({ id, sessionId, questionId: question.id, draftText: result.text, glosses: result.glosses, confidence: result.confidence, engine: result.engine, status: result.understood ? 'draft' : 'rejected', decidedAt: result.understood ? null : new Date() });
  let consecutive = session.consecutiveMisunderstandings;
  if (!result.understood) consecutive = await registerMisunderstanding(sessionId, result.note || 'not_understood');
  else await emit(sessionId, 'answer_draft', { id, questionId: question.id, text: result.text, glosses: result.glosses, confidence: result.confidence, engine: result.engine }, 'candidate');
  const fresh = await loadSession(sessionId);
  return { answerId: id, understood: result.understood, text: result.text, glosses: result.glosses, confidence: result.confidence, engine: result.engine, note: result.note, misunderstandings: consecutive, interpreter: fresh.interpreterStatus, confidenceFloor: CONFIDENCE_FLOOR };
}

/** Typed answer (communication = text, or the candidate corrected the draft themselves). */
export async function draftTypedAnswer(sessionId: string, input: { questionId: string; text: string }) {
  const session = await loadSession(sessionId);
  assertLive(session);
  const question = await requireQuestion(sessionId, input.questionId);
  const text = input.text.trim().slice(0, 3000);
  if (!text) throw new HttpError(400, 'empty_answer', 'اكتب إجابتك.');
  const db = await getDb();
  const id = randomUUID();
  await db.insert(t.interviewAnswers).values({ id, sessionId, questionId: question.id, draftText: text, engine: 'typed', confidence: 1 });
  return { answerId: id, text };
}

/** 👍 sends the sentence to the recruiter; 👎 counts as "Sanad did not understand". */
export async function decideAnswer(sessionId: string, answerId: string, input: { approved: boolean; text?: string | undefined }) {
  const session = await loadSession(sessionId);
  assertLive(session);
  const db = await getDb();
  const [answer] = await db.select().from(t.interviewAnswers).where(and(eq(t.interviewAnswers.id, answerId), eq(t.interviewAnswers.sessionId, sessionId)));
  if (!answer) throw new HttpError(404, 'answer_not_found', 'الإجابة غير موجودة.');
  if (answer.status !== 'draft') throw new HttpError(409, 'already_decided', 'تم اعتماد هذه الإجابة أو رفضها مسبقًا.');
  if (!input.approved) {
    await db.update(t.interviewAnswers).set({ status: 'rejected', decidedAt: new Date() }).where(eq(t.interviewAnswers.id, answerId));
    const count = answer.engine === 'typed' ? session.consecutiveMisunderstandings : await registerMisunderstanding(sessionId, 'candidate_rejected');
    const fresh = await loadSession(sessionId);
    return { status: 'rejected' as const, misunderstandings: count, interpreter: fresh.interpreterStatus };
  }
  const finalText = (input.text?.trim() || answer.draftText).slice(0, 3000);
  if (!finalText) throw new HttpError(400, 'empty_answer', 'الإجابة فارغة.');
  await db.update(t.interviewAnswers).set({ status: 'approved', finalText, decidedAt: new Date() }).where(eq(t.interviewAnswers.id, answerId));
  await db.update(t.interviewSessions).set({ consecutiveMisunderstandings: 0 }).where(eq(t.interviewSessions.id, sessionId));
  await emit(sessionId, 'answer_approved', { id: answerId, questionId: answer.questionId, text: finalText });
  return { status: 'approved' as const, text: finalText, misunderstandings: 0, interpreter: session.interpreterStatus };
}

export async function sendReaction(sessionId: string, input: { reactionId: string; sender: Audience }) {
  const session = await loadSession(sessionId);
  assertLive(session);
  const reaction = reactions.find(item => item.id === input.reactionId);
  if (!reaction) throw new HttpError(400, 'invalid_reaction', 'تفاعل غير معروف.');
  await emit(sessionId, 'reaction', { reactionId: reaction.id, sender: input.sender });
  return { ok: true };
}

export async function listEvents(sessionId: string, audience: Audience, after: number, waitMs: number) {
  const db = await getDb();
  const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 25_000);
  while (true) {
    const rows = await db.select().from(t.interviewEvents)
      .where(and(eq(t.interviewEvents.sessionId, sessionId), gt(t.interviewEvents.id, after), inArray(t.interviewEvents.audience, ['all', audience])))
      .orderBy(asc(t.interviewEvents.id)).limit(100);
    if (rows.length || Date.now() >= deadline) {
      return rows.map(row => ({ id: row.id, type: row.type, payload: row.payload, at: row.createdAt.toISOString() }));
    }
    await new Promise(resolve => setTimeout(resolve, 600));
  }
}

export async function sessionState(sessionId: string, audience: Audience) {
  const db = await getDb();
  const session = await loadSession(sessionId);
  const job = await requireJob(db, session.jobId);
  const questions = await db.select().from(t.interviewQuestions).where(eq(t.interviewQuestions.sessionId, sessionId)).orderBy(asc(t.interviewQuestions.seq));
  const answers = await db.select().from(t.interviewAnswers).where(eq(t.interviewAnswers.sessionId, sessionId)).orderBy(asc(t.interviewAnswers.createdAt));
  const [lastEvent] = await db.select({ id: t.interviewEvents.id }).from(t.interviewEvents).where(eq(t.interviewEvents.sessionId, sessionId)).orderBy(desc(t.interviewEvents.id)).limit(1);
  return {
    id: session.id, status: session.status, preview: session.preview, communication: session.communication,
    job: { id: job.id, title: job.title, company: job.company },
    interpreter: session.interpreterStatus, misunderstandings: session.consecutiveMisunderstandings,
    questions: questions.map(question => ({ id: question.id, seq: question.seq, original: question.original, simple: question.simple, playlist: question.signPlaylist })),
    // Drafts never leave the candidate's side.
    answers: answers.filter(answer => audience === 'candidate' || answer.status === 'approved').map(answer => ({ id: answer.id, questionId: answer.questionId, status: answer.status, text: answer.status === 'approved' ? answer.finalText : answer.draftText })),
    lastEventId: lastEvent?.id ?? 0,
  };
}

export async function endSession(sessionId: string, user: AuthUser, durationSeconds: number) {
  const db = await getDb();
  const session = await loadSession(sessionId);
  if (session.userId !== user.id) throw new HttpError(403, 'forbidden', 'لا تملك صلاحية إنهاء هذه المقابلة.');
  if (session.status === 'ended') return { reportId: null };
  const seconds = Math.max(0, Math.round(durationSeconds));
  await db.update(t.interviewSessions).set({ status: 'ended', endedAt: new Date(), durationSeconds: seconds }).where(eq(t.interviewSessions.id, sessionId));
  await emit(sessionId, 'session_ended', { durationSeconds: seconds });
  if (session.preview) return { reportId: null };
  const reportId = await createReport(user, { jobId: session.jobId, answers: [], questions: [], durationSeconds: seconds, sessionId });
  return { reportId };
}

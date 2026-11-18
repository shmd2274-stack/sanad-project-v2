import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password';
import { rateLimit } from '../auth/rate-limit';
import { createSession, type AuthUser } from '../auth/session';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { env } from '../env';
import { HttpError } from '../http/core';
import { ensureSettings } from './candidate';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkLimit(key: string, limit: number) {
  const result = rateLimit(key, limit, 15 * 60_000);
  if (!result.allowed) throw new HttpError(429, 'too_many_attempts', `محاولات كثيرة. حاول بعد ${Math.ceil(result.retryAfterSeconds / 60)} دقيقة.`);
}

export async function signUp(input: { name: string; email: string; password: string }, meta: { ip: string; userAgent: string | null }) {
  checkLimit(`signup:${meta.ip}`, 20);
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new HttpError(400, 'name_required', 'اكتب اسمك.');
  if (!EMAIL.test(email)) throw new HttpError(400, 'invalid_email', 'اكتب بريدًا إلكترونيًا صحيحًا.');
  if (input.password.length < 6) throw new HttpError(400, 'weak_password', 'كلمة المرور ٦ أحرف على الأقل.');
  const db = await getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new HttpError(409, 'email_taken', 'يوجد حساب بهذا البريد. سجّل الدخول بدلًا من ذلك.');
  const id = randomUUID();
  const role = env.adminEmails.includes(email) ? 'admin' : 'candidate';
  await db.insert(users).values({ id, name, email, passwordHash: await hashPassword(input.password), role, lastLoginAt: new Date() });
  await ensureSettings(db, id);
  const session = await createSession(id, meta);
  const user: AuthUser = { id, name, email, role };
  return { user, session };
}

export async function logIn(input: { email: string; password: string }, meta: { ip: string; userAgent: string | null }) {
  const email = input.email.trim().toLowerCase();
  checkLimit(`login:${meta.ip}`, 30);
  checkLimit(`login:${email}`, 10);
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.email, email));
  // Always run scrypt so response time does not reveal whether the email exists.
  const valid = await verifyPassword(input.password, row?.passwordHash ?? DUMMY_HASH);
  if (!row || !valid) throw new HttpError(401, 'invalid_credentials', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id));
  const session = await createSession(row.id, meta);
  const role = env.adminEmails.includes(row.email) ? 'admin' : (row.role as AuthUser['role']);
  const user: AuthUser = { id: row.id, name: row.name, email: row.email, role };
  return { user, session };
}

export async function changePassword(user: AuthUser, current: string, next: string) {
  if (next.length < 6) throw new HttpError(400, 'weak_password', 'كلمة المرور ٦ أحرف على الأقل.');
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  if (!row || !(await verifyPassword(current, row.passwordHash))) throw new HttpError(401, 'invalid_credentials', 'كلمة المرور الحالية غير صحيحة.');
  await db.update(users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(users.id, user.id));
}

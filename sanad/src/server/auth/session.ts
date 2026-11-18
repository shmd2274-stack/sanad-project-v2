import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { env } from '../env';
import { getDb } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'sanad_session';

export interface AuthUser { id: string; name: string; email: string; role: 'candidate' | 'employer' | 'admin' }

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(userId: string, meta: { userAgent?: string | null; ip?: string | null }) {
  const db = await getDb();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.sessionDays * 86_400_000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt, userAgent: meta.userAgent?.slice(0, 300) ?? null, ip: meta.ip ?? null });
  // Opportunistic cleanup keeps the table small without a cron job.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined | null): Promise<AuthUser | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const db = await getDb();
  const id = hashToken(token);
  const [row] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, lastSeenAt: sessions.lastSeenAt })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()))).limit(1);
  if (!row) return null;
  // Sliding expiry, written at most once an hour.
  if (Date.now() - row.lastSeenAt.getTime() > 3_600_000) {
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + env.sessionDays * 86_400_000) }).where(eq(sessions.id, id));
  }
  const role = env.adminEmails.includes(row.email) ? 'admin' : (row.role as AuthUser['role']);
  return { id: row.id, name: row.name, email: row.email, role };
}

export async function deleteSession(token: string | undefined | null) {
  if (!token) return;
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export function sessionCookie(token: string, expiresAt: Date): string {
  return [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1000)}`, env.production ? 'Secure' : ''].filter(Boolean).join('; ');
}

export function clearSessionCookie(): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', env.production ? 'Secure' : ''].filter(Boolean).join('; ');
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

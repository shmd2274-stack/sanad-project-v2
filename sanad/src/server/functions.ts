import { createServerFn } from '@tanstack/react-start';
import type { SanadSnapshot } from '@/lib/sanad-snapshot';

/**
 * Runs on the server during SSR (and over RPC on the client): reads the session cookie and
 * returns the signed-in candidate's data so the first paint already shows their real account.
 */
export const getBootstrap = createServerFn({ method: 'GET' }).handler(async (): Promise<SanadSnapshot | null> => {
  const [{ getCookie }, { getSessionUser, SESSION_COOKIE }, { buildSnapshot }] = await Promise.all([
    import('@tanstack/react-start/server'),
    import('./auth/session'),
    import('./services/candidate'),
  ]);
  try {
    const user = await getSessionUser(getCookie(SESSION_COOKIE));
    return user ? await buildSnapshot(user) : null;
  } catch (error) {
    console.error('[sanad] bootstrap failed', error);
    return null;
  }
});

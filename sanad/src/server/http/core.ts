import * as z from 'zod/v4';
import { getSessionUser, readCookie, SESSION_COOKIE, type AuthUser } from '../auth/session';

/** Errors carry an Arabic message the UI can show as-is, plus a stable machine code. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

export interface Ctx {
  request: Request;
  url: URL;
  params: Record<string, string>;
  ip: string;
  token: string | undefined;
  user: AuthUser | null;
  /** Extra headers (e.g. Set-Cookie) merged into the response. */
  headers: Headers;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
interface RouteDef { method: string; pattern: RegExp; keys: string[]; handler: Handler; auth: 'none' | 'user' | 'admin' }

export class Router {
  private routes: RouteDef[] = [];
  add(method: string, path: string, handler: Handler, auth: RouteDef['auth'] = 'user') {
    const keys: string[] = [];
    const pattern = new RegExp('^' + path.replace(/\/:(\w+)/g, (_, key: string) => { keys.push(key); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, pattern, keys, handler, auth });
    return this;
  }
  get(path: string, handler: Handler, auth?: RouteDef['auth']) { return this.add('GET', path, handler, auth); }
  post(path: string, handler: Handler, auth?: RouteDef['auth']) { return this.add('POST', path, handler, auth); }
  put(path: string, handler: Handler, auth?: RouteDef['auth']) { return this.add('PUT', path, handler, auth); }
  patch(path: string, handler: Handler, auth?: RouteDef['auth']) { return this.add('PATCH', path, handler, auth); }
  delete(path: string, handler: Handler, auth?: RouteDef['auth']) { return this.add('DELETE', path, handler, auth); }

  async handle(request: Request, prefix = '/api'): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice(prefix.length) || '/';
    const headers = new Headers({ 'cache-control': 'no-store' });
    try {
      const candidates = this.routes.filter(route => route.pattern.test(path));
      if (!candidates.length) throw new HttpError(404, 'not_found', 'المسار غير موجود.');
      const route = candidates.find(item => item.method === request.method || (request.method === 'HEAD' && item.method === 'GET'));
      if (!route) throw new HttpError(405, 'method_not_allowed', 'الطريقة غير مسموحة.');
      if (!['GET', 'HEAD'].includes(request.method)) assertSameOrigin(request, url);
      const match = route.pattern.exec(path);
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => { params[key] = decodeURIComponent(match?.[index + 1] ?? ''); });
      const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
      const user = route.auth === 'none' && !token ? null : await getSessionUser(token);
      if (route.auth !== 'none' && !user) throw new HttpError(401, 'unauthorized', 'سجّل الدخول للمتابعة.');
      if (route.auth === 'admin' && user?.role !== 'admin') throw new HttpError(403, 'forbidden', 'هذه العملية للمشرفين فقط.');
      const ctx: Ctx = { request, url, params, ip: clientIp(request), token, user, headers };
      const result = await route.handler(ctx);
      if (result instanceof Response) {
        headers.forEach((value, key) => { if (!result.headers.has(key)) result.headers.append(key, value); });
        return result;
      }
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(result ?? { ok: true }), { status: 200, headers });
    } catch (error) {
      headers.set('content-type', 'application/json; charset=utf-8');
      if (error instanceof HttpError) {
        return new Response(JSON.stringify({ error: { code: error.code, message: error.message, ...error.extra } }), { status: error.status, headers });
      }
      console.error('[sanad-api]', request.method, url.pathname, error);
      return new Response(JSON.stringify({ error: { code: 'server_error', message: 'حدث خطأ في الخادم. حاول مرة أخرى.' } }), { status: 500, headers });
    }
  }
}

/**
 * CSRF: cookies are SameSite=Lax, and every state-changing request must come from this origin
 * and carry the X-Sanad-Client header (a cross-site page cannot add it without a CORS preflight we never allow).
 */
function assertSameOrigin(request: Request, url: URL) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* invalid origin */ }
    if (originHost !== host) throw new HttpError(403, 'bad_origin', 'طلب من مصدر غير موثوق.');
  }
  if (request.headers.get('x-sanad-client') !== 'web') throw new HttpError(403, 'missing_client_header', 'طلب غير صالح.');
}

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

export async function readJson<T extends z.ZodType>(ctx: Ctx, schema: T, maxBytes = 1_000_000): Promise<z.infer<T>> {
  const length = Number(ctx.request.headers.get('content-length') ?? '0');
  if (length > maxBytes) throw new HttpError(413, 'too_large', 'حجم الطلب كبير جدًا.');
  let body: unknown;
  try {
    const text = await ctx.request.text();
    if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'حجم الطلب كبير جدًا.');
    body = text ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_json', 'بيانات الطلب غير صالحة.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'validation_failed', 'بيانات الطلب غير مكتملة أو غير صحيحة.', { issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) });
  return parsed.data;
}

export function requireUser(ctx: Ctx): AuthUser {
  if (!ctx.user) throw new HttpError(401, 'unauthorized', 'سجّل الدخول للمتابعة.');
  return ctx.user;
}

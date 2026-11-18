/** Browser client for the Sanad REST API (/api/*). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Off in unit tests (jsdom has no server) and during SSR; the context then stays in-memory. */
export const apiEnabled = () => typeof window !== 'undefined' && import.meta.env.MODE !== 'test';

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, init: { signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    signal: init.signal ?? null,
    headers: { 'x-sanad-client': 'web', ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: body === undefined ? null : isForm ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'http_error', error?.message ?? 'تعذّر الاتصال بالخادم. حاول مرة أخرى.');
  }
  return data as T;
}

export const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'تعذّر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.';

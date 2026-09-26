import type { ApiEnv } from './config';

/** An error answered by the API (`{ error: { code, message, details } }`) or a failure to reach it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiCall {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  accessToken?: string;
  /** The browser's IP and user agent, relayed so the API can rate-limit and record sessions per client. */
  clientIp?: string;
  userAgent?: string;
  timeoutMs?: number;
}

export interface ApiResult<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/** Calls the API from the web server. Never used in the browser. */
export async function apiFetch<T>(env: ApiEnv, path: string, call: ApiCall = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (call.body !== undefined) headers['Content-Type'] = 'application/json';
  if (call.accessToken) headers.Authorization = `Bearer ${call.accessToken}`;
  if (call.userAgent) headers['User-Agent'] = call.userAgent.slice(0, 255);
  if (env.forwardSecret && call.clientIp) {
    headers['X-IPT-Forward-Key'] = env.forwardSecret;
    headers['X-IPT-Client-IP'] = call.clientIp;
  }

  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}/api/v1${path}`, {
      method: call.method ?? (call.body === undefined ? 'GET' : 'POST'),
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(call.timeoutMs ?? 15_000),
    });
  } catch {
    throw new ApiError(503, 'API_UNAVAILABLE', 'The server cannot be reached. Try again in a moment.');
  }

  if (res.status === 204) return { data: undefined as T };
  const json = (await res.json().catch(() => null)) as { data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? 'The request failed.', e?.details);
  }
  return { data: json?.data as T, meta: json?.meta };
}

/** The browser's IP as seen by this server: the first X-Forwarded-For entry set by our proxy (nginx / Vercel). */
export function clientIpFrom(headers: Pick<Headers, 'get'>): string | undefined {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || undefined;
}

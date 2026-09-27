import 'server-only';
import { cookies, headers } from 'next/headers';
import { ApiError, apiFetch, clientIpFrom, type ApiCall, type ApiResult } from './client';
import { apiEnv } from './config';
import { clearedCookies, cookieNames, sessionCookies, type TokenPair } from './session-cookies';

/** The browser's IP and user agent for this request. */
export async function requestClient(): Promise<{ clientIp?: string; userAgent?: string }> {
  const h = await headers();
  return { clientIp: clientIpFrom(h), userAgent: h.get('user-agent') ?? undefined };
}

export async function readTokens(): Promise<{ accessToken?: string; refreshToken?: string }> {
  const jar = await cookies();
  const names = cookieNames(apiEnv().secureCookies);
  return { accessToken: jar.get(names.access)?.value || undefined, refreshToken: jar.get(names.refresh)?.value || undefined };
}

/** Calls the API as the signed-in user (server components, actions, route handlers). */
export async function api<T>(path: string, call: Omit<ApiCall, 'accessToken' | 'clientIp' | 'userAgent'> = {}): Promise<ApiResult<T>> {
  const [{ accessToken }, client] = await Promise.all([readTokens(), requestClient()]);
  return apiFetch<T>(apiEnv(), path, { ...call, ...client, accessToken });
}

/** Calls the API without the user's token (sign-in, refresh, sign-out). */
export async function apiAnonymous<T>(path: string, call: Omit<ApiCall, 'accessToken' | 'clientIp' | 'userAgent'> = {}): Promise<ApiResult<T>> {
  return apiFetch<T>(apiEnv(), path, { ...call, ...(await requestClient()) });
}

/** Stores a new session (only in server actions and route handlers, where cookies can be set). */
export async function storeSession(pair: TokenPair): Promise<void> {
  const jar = await cookies();
  for (const c of sessionCookies(pair, apiEnv().secureCookies)) jar.set(c.name, c.value, c.options);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  for (const c of clearedCookies(apiEnv().secureCookies)) jar.set(c.name, c.value, c.options);
}

/** Fetches a file from the API as the signed-in user (photos, signatures, attachments); the raw response. */
export async function apiRaw(path: string): Promise<Response> {
  const [{ accessToken }, client] = await Promise.all([readTokens(), requestClient()]);
  const env = apiEnv();
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (env.forwardSecret && client.clientIp) {
    headers['X-IPT-Forward-Key'] = env.forwardSecret;
    headers['X-IPT-Client-IP'] = client.clientIp;
  }
  return fetch(`${env.apiUrl}/api/v1${path}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
}

/** Sends a multipart upload to the API as the signed-in user. */
export async function apiUpload<T>(path: string, form: FormData): Promise<ApiResult<T>> {
  const [{ accessToken }, client] = await Promise.all([readTokens(), requestClient()]);
  const env = apiEnv();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (client.userAgent) headers['User-Agent'] = client.userAgent.slice(0, 255);
  if (env.forwardSecret && client.clientIp) {
    headers['X-IPT-Forward-Key'] = env.forwardSecret;
    headers['X-IPT-Client-IP'] = client.clientIp;
  }
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}/api/v1${path}`, { method: 'POST', headers, body: form, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new ApiError(503, 'API_UNAVAILABLE', 'The server cannot be reached. Try again in a moment.');
  }
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? 'The upload failed.', json?.error?.details);
  return { data: json?.data as T };
}

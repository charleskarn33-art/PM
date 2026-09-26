import 'server-only';
import { cookies, headers } from 'next/headers';
import { apiFetch, clientIpFrom, type ApiCall, type ApiResult } from './client';
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

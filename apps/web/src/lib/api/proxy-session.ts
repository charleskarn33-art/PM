import { NextResponse, type NextRequest } from 'next/server';
import { isPublicPath } from '@/lib/routes';
import { ApiError, apiFetch, clientIpFrom } from './client';
import { apiEnv } from './config';
import { clearedCookies, cookieNames, needsRefresh, sessionCookies, type CookieToSet, type TokenPair } from './session-cookies';

/**
 * Runs on every page request (proxy). Keeps the API session fresh: when the
 * access token is missing or about to expire, it is exchanged — with the
 * refresh token — for a new pair, stored in the cookies of both the request
 * (so this render already uses it) and the response. Visitors without a
 * session are sent to /login. The API verifies every token; this only
 * decides where to send the visitor.
 */
export async function updateApiSession(request: NextRequest, requestHeaders: Record<string, string> = {}): Promise<NextResponse> {
  const env = apiEnv();
  const names = cookieNames(env.secureCookies);
  const accessToken = request.cookies.get(names.access)?.value || undefined;
  const refreshToken = request.cookies.get(names.refresh)?.value || undefined;

  let toSet: CookieToSet[] = [];
  let signedIn = !needsRefresh(accessToken);
  if (!signedIn && refreshToken) {
    try {
      const { data } = await apiFetch<TokenPair>(env, '/auth/refresh', {
        body: { refreshToken },
        clientIp: clientIpFrom(request.headers),
        userAgent: request.headers.get('user-agent') ?? undefined,
        timeoutMs: 8_000,
      });
      toSet = sessionCookies(data, env.secureCookies);
      signedIn = true;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        toSet = clearedCookies(env.secureCookies); // the session is over
      } else {
        // API unreachable: keep the cookies; the page shows the error, a later request retries.
        signedIn = Boolean(accessToken);
      }
    }
  }

  const { pathname } = request.nextUrl;
  let response: NextResponse;
  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    response = NextResponse.redirect(url);
  } else if (signedIn && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    response = NextResponse.redirect(url);
  } else {
    // Pass the request on with the fresh cookies and any extra headers (e.g. the CSP nonce).
    for (const c of toSet) request.cookies.set(c.name, c.value);
    const headers = new Headers(request.headers);
    for (const [k, v] of Object.entries(requestHeaders)) headers.set(k, v);
    response = NextResponse.next({ request: { headers } });
  }
  for (const c of toSet) response.cookies.set(c.name, c.value, c.options);
  return response;
}

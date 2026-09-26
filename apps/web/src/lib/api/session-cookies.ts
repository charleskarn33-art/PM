/**
 * The web session: the API's access and refresh tokens in two httpOnly
 * cookies. Page scripts cannot read them; only this server uses them to
 * call the API. SameSite=Lax keeps them off cross-site form posts.
 */

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface CookieToSet {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: 'lax'; path: '/'; maxAge: number };
}

export function cookieNames(secure: boolean) {
  // __Host-: only over HTTPS, for this host only, path=/ — cannot be set by a subdomain.
  const prefix = secure ? '__Host-' : '';
  return { access: `${prefix}ipt_at`, refresh: `${prefix}ipt_rt` };
}

const maxAgeUntil = (iso: string, now: number) => Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));

export function sessionCookies(pair: TokenPair, secure: boolean, now = Date.now()): CookieToSet[] {
  const names = cookieNames(secure);
  const options = (maxAge: number) => ({ httpOnly: true as const, secure, sameSite: 'lax' as const, path: '/' as const, maxAge });
  return [
    { name: names.access, value: pair.accessToken, options: options(maxAgeUntil(pair.accessTokenExpiresAt, now)) },
    { name: names.refresh, value: pair.refreshToken, options: options(maxAgeUntil(pair.refreshTokenExpiresAt, now)) },
  ];
}

export function clearedCookies(secure: boolean): CookieToSet[] {
  const names = cookieNames(secure);
  const options = { httpOnly: true as const, secure, sameSite: 'lax' as const, path: '/' as const, maxAge: 0 };
  return [
    { name: names.access, value: '', options },
    { name: names.refresh, value: '', options },
  ];
}

/**
 * Expiry (ms) read from a JWT's payload. Not a verification — the API
 * verifies every token; this only decides when to refresh.
 */
export function jwtExpiry(token: string | undefined): number | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True when the access token is missing or expires within `skewMs`. */
export function needsRefresh(accessToken: string | undefined, now = Date.now(), skewMs = 60_000): boolean {
  const exp = jwtExpiry(accessToken);
  return exp === null || exp - skewMs <= now;
}

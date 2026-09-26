import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, clientIpFrom } from './client';
import { readApiEnv, type ApiEnv } from './config';
import { clearedCookies, cookieNames, jwtExpiry, needsRefresh, sessionCookies } from './session-cookies';

const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

describe('readApiEnv', () => {
  it('requires a valid API_URL and strips trailing slashes', () => {
    expect(readApiEnv({ API_URL: 'http://localhost:3001/' })).toEqual({ apiUrl: 'http://localhost:3001', forwardSecret: null, secureCookies: false });
    expect(() => readApiEnv({})).toThrow(/API_URL/);
    expect(() => readApiEnv({ API_URL: 'not a url' })).toThrow(/valid URL/);
  });
  it('requires https in production except on the same host or private service name, and marks cookies Secure', () => {
    expect(() => readApiEnv({ API_URL: 'http://api.example.com', NODE_ENV: 'production' })).toThrow(/https/);
    expect(readApiEnv({ API_URL: 'https://api.example.com', NODE_ENV: 'production' }).secureCookies).toBe(true);
    expect(readApiEnv({ API_URL: 'http://api:3001', NODE_ENV: 'production' }).apiUrl).toBe('http://api:3001');
  });
  it('rejects a short forward secret', () => {
    expect(() => readApiEnv({ API_URL: 'http://localhost:3001', WEB_FORWARD_SECRET: 'short' })).toThrow(/32/);
    expect(readApiEnv({ API_URL: 'http://localhost:3001', WEB_FORWARD_SECRET: 'x'.repeat(32) }).forwardSecret).toBe('x'.repeat(32));
  });
});

describe('session cookies', () => {
  const pair = { accessToken: 'a.b.c', accessTokenExpiresAt: '2026-09-26T12:15:00Z', refreshToken: 'r.s.t', refreshTokenExpiresAt: '2026-10-26T12:00:00Z' };
  const now = Date.parse('2026-09-26T12:00:00Z');

  it('are httpOnly, SameSite=Lax, path=/, expire with their token; __Host- and Secure in production', () => {
    const dev = sessionCookies(pair, false, now);
    expect(dev.map((c) => c.name)).toEqual(['ipt_at', 'ipt_rt']);
    expect(dev[0]!.options).toEqual({ httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 900 });
    expect(dev[1]!.options.maxAge).toBe(30 * 86_400);
    const prod = sessionCookies(pair, true, now);
    expect(prod.map((c) => c.name)).toEqual(['__Host-ipt_at', '__Host-ipt_rt']);
    expect(prod.every((c) => c.options.secure)).toBe(true);
    expect(clearedCookies(true).every((c) => c.value === '' && c.options.maxAge === 0)).toBe(true);
    expect(cookieNames(false)).toEqual({ access: 'ipt_at', refresh: 'ipt_rt' });
  });

  it('refresh when the access token is missing, unreadable or about to expire', () => {
    const t = Date.parse('2026-09-26T12:00:00Z');
    expect(jwtExpiry(jwt({ exp: t / 1000 + 600 }))).toBe(t + 600_000);
    expect(needsRefresh(jwt({ exp: t / 1000 + 600 }), t)).toBe(false);
    expect(needsRefresh(jwt({ exp: t / 1000 + 30 }), t)).toBe(true);
    expect(needsRefresh(undefined, t)).toBe(true);
    expect(needsRefresh('garbage', t)).toBe(true);
    expect(needsRefresh(jwt({ sub: 'x' }), t)).toBe(true);
  });
});

describe('apiFetch', () => {
  const env: ApiEnv = { apiUrl: 'http://api.test', forwardSecret: 'k'.repeat(32), secureCookies: false };
  afterEach(() => vi.unstubAllGlobals());

  it('sends JSON with the bearer token and relays the browser IP with the shared key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true }, meta: { total: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await apiFetch<{ ok: boolean }>(env, '/sites', { accessToken: 'tok', clientIp: '203.0.113.9', userAgent: 'UA', body: { a: 1 } });
    expect(r).toEqual({ data: { ok: true }, meta: { total: 1 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/sites');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
      'X-IPT-Forward-Key': 'k'.repeat(32),
      'X-IPT-Client-IP': '203.0.113.9',
      'User-Agent': 'UA',
    });
  });

  it('turns error envelopes and network failures into ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect', requestId: 'r' } }), { status: 401 })));
    await expect(apiFetch(env, '/auth/login', { body: {} })).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Incorrect' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const e = await apiFetch(env, '/x').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 503, code: 'API_UNAVAILABLE' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect(await apiFetch(env, '/auth/logout', { body: {} })).toEqual({ data: undefined });
  });

  it('does not relay an IP without a forward secret', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch({ ...env, forwardSecret: null }, '/x', { clientIp: '1.2.3.4' });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).not.toHaveProperty('X-IPT-Client-IP');
  });

  it('reads the browser IP from the first X-Forwarded-For entry', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))).toBe('203.0.113.5');
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIpFrom(new Headers())).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ApiError, SessionClient, type KeyValueStore } from './session-client';

const T0 = Date.parse('2026-09-26T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

const user = { id: 'u1', email: 'abraham.cole@example.com', fullName: 'Abraham Cole', isActive: true, mustChangePassword: false, roles: ['TECHNICIAN'], permissions: [], regionIds: [], isGlobal: false };
let n = 0;
const sessionBody = (now: number) => {
  n += 1;
  return { data: { accessToken: `at${n}`, accessTokenExpiresAt: iso(now + 900_000), refreshToken: `rt${n}`, refreshTokenExpiresAt: iso(now + 30 * 86_400_000), user } };
};
const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });

/** A fake API: records calls; `routes` decides the answers. */
function fakeApi(routes: (path: string, body: Record<string, unknown> | undefined, auth: string | undefined) => Response | Promise<Response>) {
  const calls: { path: string; body?: Record<string, unknown>; auth?: string }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('https://api.test/api/v1', '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    calls.push({ path, body, auth });
    return routes(path, body, auth);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('SessionClient', () => {
  it('signs in as the mobile client and keeps the tokens only in the secure store', async () => {
    const store = memoryStore();
    const { fetchFn, calls } = fakeApi(() => json(200, sessionBody(T0)));
    const client = new SessionClient({ apiUrl: 'https://api.test', store, fetch: fetchFn, now: () => T0 });
    const u = await client.signIn(' abraham.cole@example.com ', 'pw');
    expect(u.fullName).toBe('Abraham Cole');
    expect(calls[0]).toMatchObject({ path: '/auth/login', body: { email: 'abraham.cole@example.com', password: 'pw', client: 'mobile' } });
    const saved = JSON.parse(store.data.get('ipt.api.session')!);
    expect(saved).toMatchObject({ userId: 'u1', accessToken: expect.stringMatching(/^at/), refreshToken: expect.stringMatching(/^rt/) });
    expect(saved).not.toHaveProperty('password');
  });

  it('reports the API’s sign-in errors and "offline" when there is no connection', async () => {
    const store = memoryStore();
    const refused = fakeApi(() => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' } }));
    const c1 = new SessionClient({ apiUrl: 'https://api.test', store, fetch: refused.fetchFn });
    await expect(c1.signIn('a@b.c', 'x')).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    const down = new SessionClient({ apiUrl: 'https://api.test', store, fetch: (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch });
    const e = await down.signIn('a@b.c', 'x').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).offline).toBe(true);
    expect(store.data.size).toBe(0);
  });

  it('refreshes shortly before expiry, once for concurrent callers', async () => {
    const store = memoryStore();
    let now = T0;
    const { fetchFn, calls } = fakeApi(async (path) => {
      if (path === '/auth/refresh') await new Promise((r) => setTimeout(r, 5));
      return json(200, path === '/sites' ? { data: [] } : sessionBody(now));
    });
    const client = new SessionClient({ apiUrl: 'https://api.test', store, fetch: fetchFn, now: () => now });
    await client.signIn('a@b.c', 'pw');
    const first = await client.accessToken();
    now = T0 + 850_000; // within a minute of expiry
    const tokens = await Promise.all([client.accessToken(), client.accessToken(), client.request('/sites').then(() => 'ok')]);
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
    expect(tokens[0]).not.toBe(first);
    expect(tokens[1]).toBe(tokens[0]);
    expect(calls.find((c) => c.path === '/sites')!.auth).toBe(`Bearer ${tokens[0]}`);
  });

  it('retries a request once after a 401, then signs out if the session is over', async () => {
    const store = memoryStore();
    let refreshOk = true;
    let sitesCalls = 0;
    const { fetchFn } = fakeApi((path) => {
      if (path === '/sites') return (sitesCalls += 1) === 1 ? json(401, { error: { code: 'INVALID_TOKEN', message: 'x' } }) : json(200, { data: ['s'] });
      if (path === '/auth/refresh') return refreshOk ? json(200, sessionBody(T0)) : json(401, { error: { code: 'TOKEN_REUSED', message: 'ended' } });
      return json(200, sessionBody(T0));
    });
    const client = new SessionClient({ apiUrl: 'https://api.test', store, fetch: fetchFn, now: () => T0 });
    const changes: (string | null)[] = [];
    client.onChange((s) => changes.push(s?.userId ?? null));
    await client.signIn('a@b.c', 'pw');
    expect((await client.request<string[]>('/sites')).data).toEqual(['s']);

    refreshOk = false;
    sitesCalls = 0;
    await expect(client.request('/sites')).rejects.toMatchObject({ status: 401 });
    expect(await client.load()).toBeNull();
    expect(store.data.size).toBe(0);
    expect(changes.at(-1)).toBeNull();
  });

  it('keeps the session when offline (field work continues) and after a restart', async () => {
    const store = memoryStore();
    let online = true;
    let now = T0;
    const { fetchFn } = fakeApi(() => {
      if (!online) throw new TypeError('Network request failed');
      return json(200, sessionBody(now));
    });
    const client = new SessionClient({ apiUrl: 'https://api.test', store, fetch: fetchFn, now: () => now });
    await client.signIn('a@b.c', 'pw');
    online = false;
    now = T0 + 3_600_000; // access token expired, no network
    expect(await client.accessToken()).toMatch(/^at/);
    expect(await client.load()).not.toBeNull();

    const restarted = new SessionClient({ apiUrl: 'https://api.test', store, fetch: fetchFn, now: () => now });
    expect((await restarted.load())?.userId).toBe('u1');
    // …but not past the refresh token's own expiry.
    const later = new SessionClient({ apiUrl: 'https://api.test', store, fetch: fetchFn, now: () => T0 + 31 * 86_400_000 });
    expect(await later.load()).toBeNull();
  });

  it('signs out at the API when reachable and forgets the tokens even when not', async () => {
    const store = memoryStore();
    let online = true;
    const { fetchFn, calls } = fakeApi((path) => {
      if (!online) throw new TypeError('offline');
      return path === '/auth/logout' ? json(204, null) : json(200, sessionBody(T0));
    });
    const client = new SessionClient({ apiUrl: 'https://api.test', store, fetch: fetchFn, now: () => T0 });
    await client.signIn('a@b.c', 'pw');
    await client.signOut();
    expect(calls.at(-1)).toMatchObject({ path: '/auth/logout', body: { refreshToken: expect.stringMatching(/^rt/) } });
    expect(store.data.size).toBe(0);

    await client.signIn('a@b.c', 'pw');
    online = false;
    await client.signOut();
    expect(await client.load()).toBeNull();
  });
});

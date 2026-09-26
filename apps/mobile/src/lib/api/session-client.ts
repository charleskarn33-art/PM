/**
 * The phone's API session (platform-independent; storage and fetch are
 * injected so this is unit-tested in Node).
 *
 * - Tokens live only in the injected secure store (SecureStore on the phone).
 * - The access token is refreshed shortly before it expires; concurrent
 *   callers share one refresh (the API rotates refresh tokens on every use).
 * - A request refused with 401 is retried once after a refresh.
 * - Without a connection the stored session is kept: the field app works
 *   offline and refreshes when the network returns. Only an answer from the
 *   API that the session is over signs the user out.
 */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface StoredSession {
  userId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
  regionIds: string[];
  isGlobal: boolean;
}

interface SessionResponse extends Omit<StoredSession, 'userId'> {
  user: SessionUser;
}

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
  /** No answer from the API (offline, DNS, timeout). */
  get offline(): boolean {
    return this.code === 'OFFLINE';
  }
}

const STORAGE_KEY = 'ipt.api.session';
const REFRESH_SKEW_MS = 60_000;
/** Codes with which the API says the session itself is over (not just this token). */
const SESSION_OVER = new Set(['INVALID_TOKEN', 'SESSION_ENDED', 'TOKEN_REUSED', 'ACCOUNT_INACTIVE', 'UNAUTHORIZED']);

export interface SessionClientOptions {
  apiUrl: string;
  store: KeyValueStore;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export class SessionClient {
  private session: StoredSession | null = null;
  private loaded = false;
  private refreshing: Promise<StoredSession | null> | null = null;
  private listeners = new Set<(s: StoredSession | null) => void>();
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: SessionClientOptions) {
    this.fetchFn = opts.fetch ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
  }

  /** Called with the new session, or null when signed out. */
  onChange(listener: (s: StoredSession | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The stored session (read once from the secure store). */
  async load(): Promise<StoredSession | null> {
    if (!this.loaded) {
      const raw = await this.opts.store.getItem(STORAGE_KEY).catch(() => null);
      try {
        this.session = raw ? (JSON.parse(raw) as StoredSession) : null;
      } catch {
        this.session = null;
      }
      if (this.session && Date.parse(this.session.refreshTokenExpiresAt) <= this.now()) await this.clear();
      this.loaded = true;
    }
    return this.session;
  }

  async signIn(email: string, password: string): Promise<SessionUser> {
    const { data } = await this.call<SessionResponse>('/auth/login', { method: 'POST', body: { email: email.trim(), password, client: 'mobile' } });
    await this.save(data);
    return data.user;
  }

  /** Signs out at the API when reachable; the phone forgets the tokens either way. */
  async signOut(): Promise<void> {
    const s = await this.load();
    if (s) await this.call('/auth/logout', { method: 'POST', body: { refreshToken: s.refreshToken } }).catch(() => undefined);
    await this.clear();
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<SessionUser> {
    const { data } = await this.request<SessionResponse>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword, client: 'mobile' } });
    await this.save(data);
    return data.user;
  }

  /** An authenticated API call. */
  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ data: T; meta?: Record<string, unknown> }> {
    const token = await this.accessToken();
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in required.');
    try {
      return await this.call<T>(path, init, token);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      // The token was refused (e.g. expired early): refresh once and retry.
      const fresh = await this.refresh(true);
      if (!fresh) throw e;
      return this.call<T>(path, init, fresh.accessToken);
    }
  }

  /** An authenticated multipart upload (photos). Retried once after a refresh on 401. */
  async upload<T>(path: string, form: FormData): Promise<{ data: T }> {
    const send = async (token: string) => {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.opts.apiUrl}/api/v1${path}`, {
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new ApiError(0, 'OFFLINE', 'No connection to the server.');
      }
      const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; details?: unknown } } | null;
      if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? 'The upload failed.', json?.error?.details);
      return { data: json?.data as T };
    };
    const token = await this.accessToken();
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in required.');
    try {
      return await send(token);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      const fresh = await this.refresh(true);
      if (!fresh) throw e;
      return send(fresh.accessToken);
    }
  }

  /** A usable access token, refreshed when about to expire; null when signed out. */
  async accessToken(): Promise<string | null> {
    const s = await this.load();
    if (!s) return null;
    if (Date.parse(s.accessTokenExpiresAt) - REFRESH_SKEW_MS > this.now()) return s.accessToken;
    const fresh = await this.refresh(false);
    return fresh?.accessToken ?? null;
  }

  /** One refresh at a time. Offline: keeps the session (and its token, even if expired). */
  private refresh(force: boolean): Promise<StoredSession | null> {
    this.refreshing ??= (async () => {
      const s = await this.load();
      if (!s) return null;
      if (!force && Date.parse(s.accessTokenExpiresAt) - REFRESH_SKEW_MS > this.now()) return s;
      try {
        const { data } = await this.call<SessionResponse>('/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } });
        return await this.save(data);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403) && SESSION_OVER.has(e.code)) {
          await this.clear();
          return null;
        }
        return force ? null : s; // offline or a server problem: keep working with what we have
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async save(data: SessionResponse): Promise<StoredSession> {
    const s: StoredSession = {
      userId: data.user.id,
      accessToken: data.accessToken,
      accessTokenExpiresAt: data.accessTokenExpiresAt,
      refreshToken: data.refreshToken,
      refreshTokenExpiresAt: data.refreshTokenExpiresAt,
    };
    this.session = s;
    this.loaded = true;
    await this.opts.store.setItem(STORAGE_KEY, JSON.stringify(s));
    this.listeners.forEach((l) => l(s));
    return s;
  }

  private async clear(): Promise<void> {
    const had = this.session !== null;
    this.session = null;
    await this.opts.store.removeItem(STORAGE_KEY).catch(() => undefined);
    if (had) this.listeners.forEach((l) => l(null));
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown }, token?: string): Promise<{ data: T; meta?: Record<string, unknown> }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await this.fetchFn(`${this.opts.apiUrl}/api/v1${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
      });
    } catch {
      throw new ApiError(0, 'OFFLINE', 'No connection to the server.');
    }
    if (res.status === 204) return { data: undefined as T };
    const json = (await res.json().catch(() => null)) as { data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string; details?: unknown } } | null;
    if (!res.ok) {
      throw new ApiError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? 'The request failed.', json?.error?.details);
    }
    return { data: json?.data as T, meta: json?.meta };
  }
}

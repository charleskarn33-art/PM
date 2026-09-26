import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toAccountProfile, type AccountProfile, type ApiProfile } from '@/lib/account';
import { sessionClient } from '@/lib/api/session';
import { ApiError } from '@/lib/api/session-client';
import { sessionStorage } from '@/lib/session-storage';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: AuthStatus;
  /** The signed-in user's id (also available offline). */
  userId: string | null;
  profile: AccountProfile | null;
  profileError: string | null;
  /** The profile shown is the copy saved on this phone (no connection when the app started). */
  profileFromCache: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  reloadProfile: () => Promise<void>;
}

// Encrypted copy of the signed-in profile, so the field app opens without a connection.
const PROFILE_CACHE_KEY = 'ipt.profile';

async function readCachedProfile(userId: string): Promise<AccountProfile | null> {
  try {
    const raw = await sessionStorage.getItem(PROFILE_CACHE_KEY);
    const cached = raw ? (JSON.parse(raw) as AccountProfile) : null;
    return cached?.id === userId && 'must_change_password' in cached ? cached : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Messages for the sign-in screen. The API's own messages are written for users. */
function friendlyError(e: unknown, action: string): string {
  if (e instanceof ApiError) {
    if (e.offline) return `No Internet connection. Connect to ${action}.`;
    if (e.status < 500) return e.message;
  }
  return `Unable to ${action} right now. Try again in a moment.`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileFromCache, setProfileFromCache] = useState(false);

  const loadProfile = useCallback(async (id: string) => {
    if (!sessionClient) return;
    try {
      const { data } = await sessionClient.request<ApiProfile>('/me/profile');
      const p = toAccountProfile(data);
      setProfile(p);
      setProfileError(null);
      setProfileFromCache(false);
      await sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p)).catch(() => undefined);
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        const cached = await readCachedProfile(id);
        if (cached) {
          setProfile(cached);
          setProfileFromCache(true);
          setProfileError(null);
          return;
        }
      }
      // A session the API refuses is handled by the session listener (signed out).
      if (e instanceof ApiError && e.status === 401) return;
      setProfileError(
        e instanceof ApiError && e.offline
          ? 'Unable to load your profile: no Internet connection.'
          : e instanceof ApiError && e.status < 500
            ? e.message
            : 'Unable to load your profile right now. Try again in a moment.',
      );
    }
  }, []);

  useEffect(() => {
    if (!sessionClient) return;
    const client = sessionClient;
    let active = true;
    const off = client.onChange((s) => {
      if (!active) return;
      setUserId(s?.userId ?? null);
      setStatus(s ? 'signed-in' : 'signed-out');
      if (!s) {
        setProfile(null);
        setProfileError(null);
        setProfileFromCache(false);
        void sessionStorage.removeItem(PROFILE_CACHE_KEY).catch(() => undefined);
      }
    });
    client.load().then((s) => {
      if (!active) return;
      setUserId(s?.userId ?? null);
      setStatus(s ? 'signed-in' : 'signed-out');
      if (s) void loadProfile(s.userId);
    });
    return () => {
      active = false;
      off();
    };
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!sessionClient) return 'The app is not configured.';
      try {
        const user = await sessionClient.signIn(email, password);
        await loadProfile(user.id);
        return null;
      } catch (e) {
        return friendlyError(e, 'sign in');
      }
    },
    [loadProfile],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!sessionClient) return 'The app is not configured.';
      try {
        const user = await sessionClient.changePassword(currentPassword, newPassword);
        await loadProfile(user.id);
        return null;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'WRONG_PASSWORD') return 'Your current password is not correct.';
        if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
          const d = (e.details as { path: string; message: string }[] | undefined)?.find((x) => x.path === 'newPassword');
          return d ? `New password: ${d.message}.` : 'Check the passwords and try again.';
        }
        return friendlyError(e, 'change your password');
      }
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    await sessionClient?.signOut();
  }, []);

  const reloadProfile = useCallback(async () => {
    if (userId) await loadProfile(userId);
  }, [userId, loadProfile]);

  const value = useMemo(
    () => ({ status, userId, profile, profileError, profileFromCache, signIn, signOut, changePassword, reloadProfile }),
    [status, userId, profile, profileError, profileFromCache, signIn, signOut, changePassword, reloadProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

import type { Tables } from '@ipt/shared';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

type Profile = Tables<'profiles'>;

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function friendlyAuthError(code: string | undefined, message: string): string {
  if (code === 'invalid_credentials') return 'Incorrect email or password.';
  if (code === 'email_not_confirmed') return 'Your email address has not been confirmed yet.';
  if (/network|fetch/i.test(message)) return 'No Internet connection. Connect to sign in for the first time.';
  return `Unable to sign in: ${message}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) {
      setProfileError(
        /network|fetch/i.test(error.message)
          ? 'Unable to load your profile: no Internet connection.'
          : `Unable to load your profile: ${error.message}`,
      );
      return;
    }
    setProfileError(data ? null : 'No profile exists for this account. Contact your administrator.');
    setProfile(data);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;

    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? 'signed-in' : 'signed-out');
      if (data.session) void loadProfile(data.session.user.id);
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? 'signed-in' : 'signed-out');
      if (!next) {
        setProfile(null);
        setProfileError(null);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return 'The app is not configured.';
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return friendlyAuthError(error.code, error.message);
      const { error: auditError } = await supabase.rpc('record_login', { p_client: 'mobile' });
      if (auditError) console.warn('record_login failed', auditError.message);
      await loadProfile(data.user.id);
      return null;
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const reloadProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo(
    () => ({ status, session, profile, profileError, signIn, signOut, reloadProfile }),
    [status, session, profile, profileError, signIn, signOut, reloadProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

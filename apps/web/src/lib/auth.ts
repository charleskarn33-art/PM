import 'server-only';
import type { AppRole, Tables } from '@ipt/shared';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export interface SessionContext {
  userId: string;
  email: string;
  profile: Tables<'profiles'>;
  role: AppRole;
  regionNames: string[];
}

/**
 * Resolves the signed-in user's profile once per request. Redirects to /login
 * when there is no valid session, and to /account-inactive when the account
 * has not been activated by an administrator.
 */
export const requireSession = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) redirect('/login');

  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Unable to load your profile: ${error.message}`);
  if (!profile || !profile.is_active) redirect('/account-inactive');

  const { data: scopes, error: scopeError } = await supabase
    .from('user_region_scopes')
    .select('regions(name)')
    .eq('profile_id', userId);
  if (scopeError) throw new Error(`Unable to load your region scope: ${scopeError.message}`);

  return {
    userId,
    email: profile.email,
    profile,
    role: profile.role,
    regionNames: (scopes ?? []).flatMap((s) => (s.regions ? [s.regions.name] : [])),
  };
});

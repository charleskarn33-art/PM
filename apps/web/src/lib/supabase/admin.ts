import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@ipt/shared';
import { publicEnv } from '@/lib/env';

/**
 * Service-role client for the few operations the Auth admin API requires
 * (inviting users). Server-only: the key is read from a non-public env var and
 * this module can never be bundled for the browser. Callers MUST verify the
 * signed-in user is a Super Admin before using it.
 *
 * Returns null when SUPABASE_SECRET_KEY is not configured.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createClient<Database>(publicEnv().supabaseUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isAdminClientConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
}

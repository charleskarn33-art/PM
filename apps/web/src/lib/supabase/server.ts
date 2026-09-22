import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@ipt/shared';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Runs as the signed-in user, so every query is subject to RLS.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseKey } = publicEnv();

  return createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there. The
          // proxy refreshes the session cookie on every request instead.
        }
      },
    },
  });
}

import type { Database } from '@ipt/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { mobileEnv } from './env';
import { sessionStorage } from './session-storage';

/** null when the app is not configured (a configuration screen is shown). */
export const supabase: SupabaseClient<Database> | null = mobileEnv.ok
  ? createClient<Database>(mobileEnv.env.supabaseUrl, mobileEnv.env.supabaseKey, {
      auth: {
        storage: sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Only refresh tokens while the app is in the foreground.
if (supabase) {
  const client = supabase;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });
}

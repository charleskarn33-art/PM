import type { Database } from '@ipt/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { mobileEnv } from './env';
import { sessionStorage } from './session-storage';

/**
 * Legacy data sync (offline store) until it moves to the API in Phase 7.
 * Sign-in no longer uses Supabase. null when not configured.
 */
export const supabase: SupabaseClient<Database> | null =
  mobileEnv.ok && mobileEnv.env.supabaseUrl && mobileEnv.env.supabaseKey
  ? createClient<Database>(mobileEnv.env.supabaseUrl, mobileEnv.env.supabaseKey, {
      auth: {
        storage: sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      // The offline sync engine retries with its own back-off; library retries
      // would only delay it (and the UI) while there is no connection.
      db: { retry: false },
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

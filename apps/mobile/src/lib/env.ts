export interface MobileEnv {
  supabaseUrl: string;
  supabaseKey: string;
}

export type EnvResult = { ok: true; env: MobileEnv } | { ok: false; error: string };

/**
 * Validates the public Supabase configuration. Returns a descriptive error
 * instead of throwing so the app can show a configuration screen.
 */
export function readMobileEnv(source: Record<string, string | undefined>): EnvResult {
  const supabaseUrl = source.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = (source.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? source.EXPO_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const missing = [
    !supabaseUrl && 'EXPO_PUBLIC_SUPABASE_URL',
    !supabaseKey && 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ].filter(Boolean);
  if (missing.length > 0) {
    return { ok: false, error: `Missing configuration: ${missing.join(', ')}. See apps/mobile/.env.example.` };
  }
  if (!/^https?:\/\/[^\s/]+/.test(supabaseUrl!)) {
    return { ok: false, error: 'EXPO_PUBLIC_SUPABASE_URL is not a valid URL.' };
  }
  if (supabaseKey!.startsWith('sb_secret_') || /service[_-]?role/i.test(supabaseKey!)) {
    return { ok: false, error: 'A secret/service-role key was configured. Use the publishable (anon) key.' };
  }
  return { ok: true, env: { supabaseUrl: supabaseUrl!, supabaseKey: supabaseKey! } };
}

// Expo inlines EXPO_PUBLIC_* only when referenced literally.
export const mobileEnv = readMobileEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

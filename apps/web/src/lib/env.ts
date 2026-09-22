export interface PublicEnv {
  supabaseUrl: string;
  supabaseKey: string;
}

/**
 * Reads the public Supabase configuration. Accepts the newer publishable key
 * name or the legacy anon key name. Throws a descriptive error when missing so
 * misconfiguration never fails silently.
 */
export function readPublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const supabaseUrl = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = (source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? source.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseKey) missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}. See apps/web/.env.example.`);
  }
  try {
    new URL(supabaseUrl!);
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not a valid URL.');
  }
  if (/service[_-]?role/i.test(supabaseKey!) || supabaseKey!.startsWith('sb_secret_')) {
    throw new Error('A secret/service-role key was provided to the web app. Use the publishable (anon) key.');
  }
  return { supabaseUrl: supabaseUrl!, supabaseKey: supabaseKey! };
}

// Next.js inlines NEXT_PUBLIC_* only when referenced literally.
export function publicEnv(): PublicEnv {
  return readPublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

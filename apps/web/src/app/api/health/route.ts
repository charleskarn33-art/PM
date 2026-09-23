import { NextResponse } from 'next/server';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Health check for uptime monitoring (no sign-in): the web server is up and
 * can reach the Supabase project. Reveals nothing beyond that and the
 * deployed commit.
 */
export async function GET() {
  let supabase: 'ok' | 'unreachable' | 'misconfigured' = 'ok';
  try {
    const { supabaseUrl, supabaseKey } = publicEnv();
    const r = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: supabaseKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) supabase = 'unreachable';
  } catch (e) {
    supabase = e instanceof Error && e.message.startsWith('Missing environment') ? 'misconfigured' : 'unreachable';
  }
  const ok = supabase === 'ok';
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', supabase, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

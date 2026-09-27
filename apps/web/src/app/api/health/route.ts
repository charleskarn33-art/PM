import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api/client';
import { apiEnv } from '@/lib/api/config';

export const dynamic = 'force-dynamic';

/**
 * Health check for uptime monitoring (no sign-in): the web server is up and
 * the API (and through it the database) is ready. Reveals nothing beyond that
 * and the deployed commit.
 */
export async function GET() {
  let api: 'ok' | 'unreachable' | 'misconfigured' = 'ok';
  try {
    await apiFetch(apiEnv(), '/health/ready', { timeoutMs: 5000 });
  } catch (e) {
    api = e instanceof Error && /API_URL|environment/i.test(e.message) ? 'misconfigured' : 'unreachable';
  }
  const ok = api === 'ok';
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', api, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

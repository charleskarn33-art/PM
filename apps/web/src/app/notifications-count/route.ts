import { NextResponse } from 'next/server';
import { apiRaw, readTokens } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

/** The signed-in user's unread notification count, for the header bell. */
export async function GET() {
  if (!(await readTokens()).accessToken) return NextResponse.json({ unread: 0 }, { status: 401 });
  try {
    const res = await apiRaw('/notifications/unread-count', 10_000);
    if (!res.ok) return NextResponse.json({ unread: 0 }, { status: res.status });
    const body = (await res.json()) as { data?: { unread?: number } };
    return NextResponse.json({ unread: body.data?.unread ?? 0 }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ unread: 0 }, { status: 503 });
  }
}

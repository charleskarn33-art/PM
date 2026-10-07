import { NextResponse, type NextRequest } from 'next/server';
import { apiRaw, readTokens } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

/** Relays the audit log CSV (the API checks audit.read and records the export). */
export async function GET(req: NextRequest) {
  if (!(await readTokens()).accessToken) return new NextResponse('Sign in required', { status: 401 });
  const query = new URLSearchParams([...req.nextUrl.searchParams].filter(([, v]) => v !== ''));
  let res: Response;
  try {
    res = await apiRaw(`/audit/export.csv${query.size ? `?${query}` : ''}`, 10 * 60_000);
  } catch {
    return new NextResponse('The server cannot be reached.', { status: 503 });
  }
  if (!res.ok) return new NextResponse(res.status === 403 ? 'You may not export the audit log.' : 'The export is not available.', { status: res.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const headers = new Headers();
  for (const h of ['content-type', 'content-disposition', 'cache-control']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  return new NextResponse(res.body, { status: 200, headers });
}

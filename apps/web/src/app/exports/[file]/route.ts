import { NextResponse, type NextRequest } from 'next/server';
import { apiRaw, readTokens } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

const DATASETS = ['visits', 'schedules', 'failures', 'corrective-actions', 'sites', 'readings'];
const PASS_HEADERS = ['content-type', 'content-disposition', 'cache-control'];

/**
 * Relays a CSV export from the API with the user's session, keeping the
 * filters in the query string. The API checks the permission and scope and
 * streams the rows; this passes them through as they come.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const file = (await params).file;
  const dataset = file.replace(/\.csv$/, '');
  if (!file.endsWith('.csv') || !DATASETS.includes(dataset)) return new NextResponse('Not found', { status: 404 });
  if (!(await readTokens()).accessToken) return new NextResponse('Sign in required', { status: 401 });
  let res: Response;
  try {
    // Filters left empty in a form are not sent (the API would reject an empty value).
    const query = new URLSearchParams([...req.nextUrl.searchParams].filter(([, v]) => v !== ''));
    const search = query.size ? `?${query}` : '';
    res = await apiRaw(`/exports/${dataset}.csv${search}`, 10 * 60_000);
  } catch {
    return new NextResponse('The server cannot be reached.', { status: 503 });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const message = res.status === 403 ? 'You may not export this.' : res.status === 422 ? (body?.error?.message ?? 'The filters are not valid.') : 'The export is not available.';
    return new NextResponse(message, { status: res.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  return new NextResponse(res.body, { status: 200, headers });
}

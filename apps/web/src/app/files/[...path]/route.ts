import { NextResponse, type NextRequest } from 'next/server';
import { apiRaw, readTokens } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The only API files the browser may fetch through this server. */
const ALLOWED = [
  new RegExp(`^visits/${UUID}/photos/${UUID}$`),
  new RegExp(`^visits/${UUID}/signature$`),
  new RegExp(`^failures/${UUID}/attachments/${UUID}$`),
];
const PASS_HEADERS = ['content-type', 'content-length', 'content-disposition', 'cache-control'];

/**
 * Relays photos, signatures and attachments from the API with the user's
 * session (the browser never holds the API token). The API checks access to
 * each file; this only forwards allowed paths.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/').toLowerCase();
  if (!ALLOWED.some((r) => r.test(path))) return new NextResponse('Not found', { status: 404 });
  if (!(await readTokens()).accessToken) return new NextResponse('Sign in required', { status: 401 });
  let res: Response;
  try {
    res = await apiRaw(`/${path}`);
  } catch {
    return new NextResponse('The server cannot be reached.', { status: 503 });
  }
  if (!res.ok) return new NextResponse(res.status === 404 ? 'Not found' : 'Unavailable', { status: res.status === 404 || res.status === 403 ? 404 : res.status });
  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  // An SVG signature is shown as an image only; it never runs anything.
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  return new NextResponse(res.body, { status: 200, headers });
}

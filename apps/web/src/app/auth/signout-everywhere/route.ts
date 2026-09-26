import { NextResponse, type NextRequest } from 'next/server';
import { api, clearSession } from '@/lib/api/server';

/** Ends every session of the user (all browsers and phones), then this one's cookies. */
export async function POST(request: NextRequest) {
  await api('/auth/logout-all', { method: 'POST' }).catch((e: unknown) => console.error('logout-all at the API failed', e));
  await clearSession();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}

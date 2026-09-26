import { NextResponse, type NextRequest } from 'next/server';
import { apiAnonymous, clearSession, readTokens } from '@/lib/api/server';

/** Ends the session at the API (its whole refresh-token family) and clears the cookies. */
export async function POST(request: NextRequest) {
  const { refreshToken } = await readTokens();
  if (refreshToken) {
    // Signing out locally must work even if the API cannot be reached.
    await apiAnonymous('/auth/logout', { body: { refreshToken } }).catch((e: unknown) => console.error('logout at the API failed', e));
  }
  await clearSession();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}

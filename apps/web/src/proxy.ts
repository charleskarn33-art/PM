import type { NextRequest } from 'next/server';
import { buildCsp, createNonce } from '@/lib/csp';
import { publicEnv } from '@/lib/env';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({ nonce, supabaseUrl: publicEnv().supabaseUrl, dev: process.env.NODE_ENV === 'development' });
  // Next.js reads the nonce from the request's CSP header and applies it to its scripts.
  const response = await updateSession(request, { 'x-nonce': nonce, 'Content-Security-Policy': csp });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

import type { NextRequest } from 'next/server';
import { updateApiSession } from '@/lib/api/proxy-session';
import { buildCsp, createNonce } from '@/lib/csp';

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  // Pages not yet moved to the API still load images from the (legacy) Supabase project, when configured.
  const csp = buildCsp({ nonce, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, dev: process.env.NODE_ENV === 'development' });
  // Next.js reads the nonce from the request's CSP header and applies it to its scripts.
  const response = await updateApiSession(request, { 'x-nonce': nonce, 'Content-Security-Policy': csp });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

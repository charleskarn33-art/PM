import { createServerClient } from '@supabase/ssr';
import type { Database } from '@ipt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { isPublicPath } from '@/lib/routes';

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated visitors to /login. Authorization (role / RLS) is enforced
 * by the database and re-checked in the portal layout.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { supabaseUrl, supabaseKey } = publicEnv();

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims() validates the JWT; do not run code between client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

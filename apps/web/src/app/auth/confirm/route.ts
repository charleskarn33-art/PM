import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ALLOWED_TYPES: EmailOtpType[] = ['invite', 'recovery', 'email', 'signup', 'email_change'];
// Only these in-app destinations may be reached from an email link.
const ALLOWED_NEXT = new Set(['/auth/set-password', '/dashboard']);

/**
 * Landing route for Supabase auth emails (invitation, password reset).
 * Email templates must link to:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=/auth/set-password
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const nextParam = searchParams.get('next') ?? '/dashboard';
  const next = ALLOWED_NEXT.has(nextParam) ? nextParam : '/dashboard';

  const fail = (reason: string) => {
    const url = new URL('/login', request.url);
    url.searchParams.set('error', reason);
    return NextResponse.redirect(url);
  };

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) return fail('invalid_link');

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return fail('expired_link');
  return NextResponse.redirect(new URL(next, request.url));
}

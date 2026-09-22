'use server';

import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/routes';
import { createClient } from '@/lib/supabase/server';

export interface LoginState {
  error?: string;
  email?: string;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? ''));

  if (!email || !password) {
    return { error: 'Enter your email address and password.', email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const message =
      error.code === 'invalid_credentials'
        ? 'Incorrect email or password.'
        : error.code === 'email_not_confirmed'
          ? 'Your email address has not been confirmed yet. Check your inbox for the confirmation link.'
          : `Unable to sign in: ${error.message}`;
    return { error: message, email };
  }

  // Audit the login. A failure here must not block access, but it is reported.
  const { error: auditError } = await supabase.rpc('record_login', { p_client: 'web' });
  if (auditError) console.error('record_login failed', auditError);

  redirect(next);
}

'use server';

import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { apiAnonymous, storeSession } from '@/lib/api/server';
import type { TokenPair } from '@/lib/api/session-cookies';
import { safeNextPath } from '@/lib/routes';

export interface LoginState {
  error?: string;
  email?: string;
}

/** Signs in through the API; the tokens go into httpOnly cookies, never to the page. */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? ''));

  if (!email || !password) {
    return { error: 'Enter your email address and password.', email };
  }

  let session: TokenPair & { user: { mustChangePassword: boolean } };
  try {
    session = (await apiAnonymous<typeof session>('/auth/login', { body: { email, password, client: 'web' } })).data;
  } catch (e) {
    if (e instanceof ApiError) {
      // The API's messages for these are written for users (and never reveal whether an account exists).
      if (['INVALID_CREDENTIALS', 'ACCOUNT_INACTIVE', 'TOO_MANY_REQUESTS', 'API_UNAVAILABLE'].includes(e.code)) return { error: e.message, email };
      if (e.code === 'VALIDATION_FAILED') return { error: 'Enter a valid email address and password.', email };
    }
    console.error('sign-in failed', e instanceof ApiError ? { status: e.status, code: e.code } : e);
    return { error: 'Unable to sign in right now. Try again in a moment.', email };
  }

  await storeSession(session);
  redirect(session.user.mustChangePassword ? '/change-password' : next);
}

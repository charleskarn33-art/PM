'use server';

import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { api, storeSession } from '@/lib/api/server';
import type { TokenPair } from '@/lib/api/session-cookies';

export interface ChangePasswordState {
  error?: string;
}

const MIN_PASSWORD_LENGTH = 12;

/** Replaces the password (a temporary one, or the user's own). Other sessions end; this browser gets a new one. */
export async function changePassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (!currentPassword) return { error: 'Enter your current password.' };
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.` };
  if (newPassword !== confirm) return { error: 'The new passwords do not match.' };

  let session: TokenPair;
  try {
    session = (await api<TokenPair>('/auth/change-password', { body: { currentPassword, newPassword, client: 'web' } })).data;
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) redirect('/login');
      if (e.code === 'WRONG_PASSWORD') return { error: 'Your current password is not correct.' };
      if (e.code === 'VALIDATION_FAILED') {
        const detail = (e.details as { path: string; message: string }[] | undefined)?.find((d) => d.path === 'newPassword');
        return { error: detail ? `New password: ${detail.message}.` : 'Check the passwords and try again.' };
      }
      if (e.code === 'TOO_MANY_REQUESTS' || e.code === 'API_UNAVAILABLE') return { error: e.message };
    }
    console.error('change-password failed', e instanceof ApiError ? { status: e.status, code: e.code } : e);
    return { error: 'Unable to change your password right now. Try again in a moment.' };
  }
  await storeSession(session);
  redirect('/dashboard');
}

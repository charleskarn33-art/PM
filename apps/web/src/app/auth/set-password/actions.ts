'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface SetPasswordState {
  error?: string;
}

const MIN_PASSWORD_LENGTH = 10;

export async function setPassword(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password !== confirm) return { error: 'The passwords do not match.' };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { error: 'Your link has expired. Request a new one from the sign-in page.' };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      error: /weak|pwned|leaked/i.test(error.message)
        ? 'This password is too weak or has appeared in a data breach. Choose another.'
        : `Unable to set your password: ${error.message}`,
    };
  }
  redirect('/dashboard');
}

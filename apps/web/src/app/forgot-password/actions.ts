'use server';

import { createClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/site-url';

export interface ForgotState {
  sent?: boolean;
  error?: string;
}

export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/auth/set-password`,
  });
  // Rate limits are reported; other outcomes are not, so the form never reveals whether an account exists.
  if (error && error.status === 429) return { error: 'Too many requests. Wait a few minutes and try again.' };
  if (error) console.error('resetPasswordForEmail failed', error.message);
  return { sent: true };
}

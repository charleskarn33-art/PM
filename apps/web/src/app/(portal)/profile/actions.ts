'use server';

import { revalidatePath } from 'next/cache';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/server';
import { requireSession } from '@/lib/auth';
import { formValues, type FormValues } from '@/lib/form-values';

export interface ProfileFormState {
  status?: 'saved' | 'error';
  message?: string;
  values?: FormValues;
}

export async function updateProfile(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  await requireSession();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const values = formValues(formData);

  if (fullName.length < 2) return { status: 'error', message: 'Full name must be at least 2 characters.', values };
  if (fullName.length > 120) return { status: 'error', message: 'Full name must be 120 characters or fewer.', values };
  if (phone && !/^[+()\d\s-]{6,20}$/.test(phone)) {
    return { status: 'error', message: 'Enter a valid phone number (digits, spaces, +, -, parentheses).', values };
  }

  try {
    await api('/me/profile', { method: 'PATCH', body: { fullName, phone } });
  } catch (e) {
    const message = e instanceof ApiError && e.status < 500 ? e.message : 'Unable to save your profile right now. Try again in a moment.';
    return { status: 'error', message, values };
  }

  revalidatePath('/', 'layout');
  return { status: 'saved', message: 'Profile saved.' };
}

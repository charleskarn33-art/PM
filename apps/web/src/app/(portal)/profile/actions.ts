'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ProfileFormState {
  status?: 'saved' | 'error';
  message?: string;
}

export async function updateProfile(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const session = await requireSession();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();

  if (fullName.length < 2) return { status: 'error', message: 'Full name must be at least 2 characters.' };
  if (fullName.length > 120) return { status: 'error', message: 'Full name must be 120 characters or fewer.' };
  if (phone && !/^[+()\d\s-]{6,20}$/.test(phone)) {
    return { status: 'error', message: 'Enter a valid phone number (digits, spaces, +, -, parentheses).' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName, phone: phone || null })
    .eq('id', session.userId);
  if (error) return { status: 'error', message: `Unable to save your profile: ${error.message}` };

  revalidatePath('/', 'layout');
  return { status: 'saved', message: 'Profile saved.' };
}

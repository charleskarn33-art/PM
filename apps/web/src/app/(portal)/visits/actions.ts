'use server';

import { isUuid } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ReviewState {
  error?: string;
  success?: string;
}

export async function reviewVisit(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireCapability('review_pm');
  const id = String(formData.get('visit_id') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const comments = String(formData.get('review_comments') ?? '').trim();
  if (!isUuid(id)) return { error: 'Invalid PM visit.' };
  if (decision !== 'APPROVED' && decision !== 'REJECTED') return { error: 'Choose approve or reject.' };
  if (decision === 'REJECTED' && comments.length < 5) {
    return { error: 'Explain what the technician must correct (at least 5 characters).' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pm_visits')
    .update({ status: decision, review_comments: comments || null })
    .eq('id', id)
    .select('id');
  if (error) return { error: `Unable to record the review: ${error.message}` };
  if (!data?.length) return { error: 'You are not the reviewer for this PM visit.' };
  revalidatePath(`/visits/${id}`);
  revalidatePath('/visits');
  return { success: decision === 'APPROVED' ? 'PM approved.' : 'PM rejected and returned to the technician.' };
}

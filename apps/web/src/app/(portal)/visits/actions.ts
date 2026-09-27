'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/api/server';
import { requireSession } from '@/lib/auth';
import { submit, text, type FormState } from '@/lib/form-action';

export async function reviewVisit(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'visitId') ?? '';
  const decision = text(formData, 'decision') === 'REJECT' ? 'REJECT' : 'APPROVE';
  const result = await submit(
    formData,
    () => api(`/visits/${id}/review`, { body: { decision, comments: text(formData, 'comments') } }),
    decision === 'APPROVE' ? 'PM approved.' : 'PM returned to the technician for correction.',
    [`/visits/${id}`, '/visits', '/dashboard'],
  );
  // The review form disappears once reviewed: say what happened at the top of the page.
  if (result.success) redirect(`/visits/${id}?done=${decision === 'APPROVE' ? 'approved' : 'returned'}`);
  return result;
}

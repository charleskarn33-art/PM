'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/api/server';
import { requireSession } from '@/lib/auth';
import { submit, text, type FormState } from '@/lib/form-action';

const STEPS = {
  start: 'Work started.',
  complete: 'Marked completed.',
  verify: 'Verification recorded.',
  close: 'Action closed.',
  assign: 'Assigned.',
} as const;

/** One workflow step (`step` field); the API decides who may take it and from which status. */
export async function actionStep(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id') ?? '';
  const failureId = text(formData, 'failureId') ?? '';
  const step = text(formData, 'step') as keyof typeof STEPS;
  if (!(step in STEPS)) return { error: 'Unknown step.' };
  const body =
    step === 'complete'
      ? { note: text(formData, 'note') ?? '' }
      : step === 'verify'
        ? { decision: text(formData, 'decision') === 'REJECT' ? 'REJECT' : 'APPROVE', note: text(formData, 'note') }
        : step === 'close'
          ? { note: text(formData, 'note') }
          : step === 'assign'
            ? { assignedToId: text(formData, 'assignedToId'), dueDate: text(formData, 'dueDate', true) }
            : undefined;
  const rejected = step === 'verify' && text(formData, 'decision') === 'REJECT';
  const result = await submit(formData, () => api(`/corrective-actions/${id}/${step}`, { method: 'POST', body }), rejected ? 'Sent back for rework.' : STEPS[step], [
    `/corrective-actions/${id}`,
    '/corrective-actions',
    `/failures/${failureId}`,
    '/dashboard',
  ]);
  // The form that was used disappears with the new status: say what happened at the top of the page.
  if (result.success) redirect(`/corrective-actions/${id}?done=${rejected ? 'reject' : step}`);
  return result;
}

export async function updateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id') ?? '';
  return submit(
    formData,
    () =>
      api(`/corrective-actions/${id}`, {
        method: 'PATCH',
        body: { title: text(formData, 'title'), description: text(formData, 'description', true), priority: text(formData, 'priority'), dueDate: text(formData, 'dueDate', true) },
      }),
    'Action updated.',
    [`/corrective-actions/${id}`],
  );
}

'use server';

import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/server';
import { requireSession } from '@/lib/auth';
import { fieldErrorsOf, messageOf, submit, text, type FormState } from '@/lib/form-action';
import { formValues } from '@/lib/form-values';

export async function createSchedule(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const body = {
    siteId: text(formData, 'siteId'),
    technicianId: text(formData, 'technicianId'),
    templateCode: text(formData, 'templateCode'),
    frequency: text(formData, 'frequency'),
    scheduledDate: text(formData, 'scheduledDate'),
    dueDate: text(formData, 'dueDate'),
    occurrences: Number(text(formData, 'occurrences') ?? 1),
    priority: text(formData, 'priority'),
    notes: text(formData, 'notes'),
  };
  let created: { id: string }[];
  try {
    created = (await api<{ id: string }[]>('/pm-schedules', { body })).data;
  } catch (e) {
    return { error: messageOf(e), fieldErrors: e instanceof ApiError ? fieldErrorsOf(e) : undefined, values: formValues(formData) };
  }
  redirect(created.length === 1 ? `/schedule/${created[0]!.id}` : `/schedule?site=${body.siteId}`);
}

export async function updateSchedule(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id') ?? '';
  return submit(
    formData,
    () =>
      api(`/pm-schedules/${id}`, {
        method: 'PATCH',
        body: {
          technicianId: text(formData, 'technicianId', true),
          scheduledDate: text(formData, 'scheduledDate'),
          dueDate: text(formData, 'dueDate'),
          priority: text(formData, 'priority'),
          notes: text(formData, 'notes', true),
        },
      }),
    'Schedule saved.',
    [`/schedule/${id}`, '/schedule'],
  );
}

export async function cancelSchedule(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id') ?? '';
  return submit(formData, () => api(`/pm-schedules/${id}/cancel`, { body: { reason: text(formData, 'reason') ?? '' } }), 'PM cancelled.', [`/schedule/${id}`, '/schedule']);
}

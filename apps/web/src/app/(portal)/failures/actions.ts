'use server';

import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { api, apiUpload } from '@/lib/api/server';
import { requireSession } from '@/lib/auth';
import { fieldErrorsOf, messageOf, submit, text, type FormState } from '@/lib/form-action';
import { formValues } from '@/lib/form-values';

export async function reportFailure(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  let id: string;
  try {
    id = (
      await api<{ id: string }>('/failures', {
        body: {
          id: text(formData, 'requestId'),
          siteId: text(formData, 'siteId'),
          title: text(formData, 'title') ?? '',
          description: text(formData, 'description', true),
          severity: text(formData, 'severity'),
          category: text(formData, 'category'),
        },
      })
    ).data.id;
  } catch (e) {
    return { error: messageOf(e), fieldErrors: e instanceof ApiError ? fieldErrorsOf(e) : undefined, values: formValues(formData) };
  }
  redirect(`/failures/${id}`);
}

const paths = (id: string) => [`/failures/${id}`, '/failures', '/dashboard'];

export async function updateFailure(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id') ?? '';
  return submit(
    formData,
    () => api(`/failures/${id}`, { method: 'PATCH', body: { title: text(formData, 'title'), description: text(formData, 'description', true), severity: text(formData, 'severity') } }),
    'Failure updated.',
    paths(id),
  );
}

export async function closeOrReopenFailure(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id') ?? '';
  const reopen = text(formData, 'op') === 'reopen';
  return submit(formData, () => api(`/failures/${id}/${reopen ? 'reopen' : 'close'}`, { body: { note: text(formData, 'note') ?? '' } }), reopen ? 'Failure reopened.' : 'Failure closed.', paths(id));
}

export async function addComment(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id') ?? '';
  const actionId = text(formData, 'correctiveActionId');
  return submit(
    formData,
    () => api(`/failures/${id}/comments`, { body: { body: text(formData, 'body') ?? '', ...(actionId ? { correctiveActionId: actionId } : {}) } }),
    'Comment added.',
    [...paths(id), ...(actionId ? [`/corrective-actions/${actionId}`] : [])],
  );
}

/** Relays a photo or PDF to the API (which checks the type by content and the size). */
export async function uploadAttachment(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id') ?? '';
  const actionId = text(formData, 'correctiveActionId');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a photo or PDF to attach.' };
  const form = new FormData();
  form.append('file', file, file.name);
  const caption = text(formData, 'caption');
  if (caption) form.append('caption', caption);
  if (actionId) form.append('correctiveActionId', actionId);
  return submit(formData, () => apiUpload(`/failures/${id}/attachments`, form), 'File attached.', [...paths(id), ...(actionId ? [`/corrective-actions/${actionId}`] : [])]);
}

export async function removeAttachment(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id') ?? '';
  return submit(formData, () => api(`/failures/${id}/attachments/${text(formData, 'attachmentId')}`, { method: 'DELETE' }), 'File removed.', paths(id));
}

export async function createAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const failureId = text(formData, 'failureId') ?? '';
  let actionId: string;
  try {
    actionId = (
      await api<{ id: string }>('/corrective-actions', {
        body: {
          id: text(formData, 'requestId'),
          failureId,
          title: text(formData, 'title') ?? '',
          description: text(formData, 'description', true),
          priority: text(formData, 'priority'),
          assignedToId: text(formData, 'assignedToId'),
          dueDate: text(formData, 'dueDate'),
        },
      })
    ).data.id;
  } catch (e) {
    return { error: messageOf(e), fieldErrors: e instanceof ApiError ? fieldErrorsOf(e) : undefined, values: formValues(formData) };
  }
  redirect(`/corrective-actions/${actionId}`);
}

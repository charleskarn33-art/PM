'use server';

import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/server';
import { requirePermission } from '@/lib/auth';
import { fieldErrorsOf, messageOf, submit, text, type FormState } from '@/lib/form-action';
import { formValues } from '@/lib/form-values';

const bool = (fd: FormData, k: string) => fd.get(k) === 'on';
const num = (fd: FormData, k: string) => {
  const v = text(fd, k);
  return v === undefined ? null : Number(v);
};
const lines = (fd: FormData, k: string) =>
  String(fd.get(k) ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
const failed = (e: unknown, fd: FormData): FormState => ({ error: messageOf(e), fieldErrors: e instanceof ApiError ? fieldErrorsOf(e) : undefined, values: formValues(fd) });

export async function createTemplate(_prev: FormState, fd: FormData): Promise<FormState> {
  await requirePermission('pm_templates.manage');
  let id: string;
  try {
    id = (await api<{ id: string }>('/pm-templates', { body: { code: text(fd, 'code') ?? '', name: text(fd, 'name') ?? '', description: text(fd, 'description', true) } })).data.id;
  } catch (e) {
    return failed(e, fd);
  }
  redirect(`/admin/templates/${id}`);
}

/** Version steps on a template: `new-version`, `activate`, `delete`, `save` (name / description). */
export async function templateStep(_prev: FormState, fd: FormData): Promise<FormState> {
  await requirePermission('pm_templates.manage');
  const id = text(fd, 'id') ?? '';
  const step = text(fd, 'step');
  if (step === 'new-version') {
    let draft: string;
    try {
      draft = (await api<{ id: string }>(`/pm-templates/${id}/new-version`, { method: 'POST' })).data.id;
    } catch (e) {
      return failed(e, fd);
    }
    redirect(`/admin/templates/${draft}`);
  }
  if (step === 'delete') {
    try {
      await api(`/pm-templates/${id}`, { method: 'DELETE' });
    } catch (e) {
      return failed(e, fd);
    }
    redirect('/admin/templates');
  }
  if (step === 'activate') return submit(fd, () => api(`/pm-templates/${id}/activate`, { method: 'POST' }), 'Version activated. Open schedules now use it; visits keep the version they started on.', ['/admin/templates', `/admin/templates/${id}`]);
  if (step === 'save') return submit(fd, () => api(`/pm-templates/${id}`, { method: 'PATCH', body: { name: text(fd, 'name'), description: text(fd, 'description', true) } }), 'Saved.', [`/admin/templates/${id}`]);
  return { error: 'Unknown step.' };
}

export async function saveSection(_prev: FormState, fd: FormData): Promise<FormState> {
  await requirePermission('pm_templates.manage');
  const templateId = text(fd, 'templateId') ?? '';
  const id = text(fd, 'id');
  if (text(fd, 'op') === 'delete' && id) return submit(fd, () => api(`/pm-sections/${id}`, { method: 'DELETE' }), 'Section removed.', [`/admin/templates/${templateId}`]);
  const body = {
    code: text(fd, 'code') ?? '',
    name: text(fd, 'name') ?? '',
    category: text(fd, 'category'),
    sortOrder: num(fd, 'sortOrder') ?? 0,
    description: text(fd, 'description', true),
    allowNotApplicable: bool(fd, 'allowNotApplicable'),
    requiresEquipment: text(fd, 'requiresEquipment', true),
    isActive: id ? bool(fd, 'isActive') : true,
  };
  return submit(fd, () => api(id ? `/pm-sections/${id}` : `/pm-templates/${templateId}/sections`, { method: id ? 'PATCH' : 'POST', body }), id ? 'Section saved.' : 'Section added.', [`/admin/templates/${templateId}`]);
}

export async function saveItem(_prev: FormState, fd: FormData): Promise<FormState> {
  await requirePermission('pm_templates.manage');
  const templateId = text(fd, 'templateId') ?? '';
  const id = text(fd, 'id');
  const sectionId = text(fd, 'sectionId') ?? '';
  try {
    if (text(fd, 'op') === 'delete' && id) {
      await api(`/pm-items/${id}`, { method: 'DELETE' });
    } else {
      const body = {
        code: text(fd, 'code') ?? '',
        prompt: text(fd, 'prompt') ?? '',
        helpText: text(fd, 'helpText', true),
        responseType: text(fd, 'responseType'),
        options: lines(fd, 'options'),
        allowNotApplicable: bool(fd, 'allowNotApplicable'),
        isRequired: bool(fd, 'isRequired'),
        unit: text(fd, 'unit', true),
        minValue: num(fd, 'minValue'),
        maxValue: num(fd, 'maxValue'),
        isInteger: bool(fd, 'isInteger'),
        failureOnAnswer: text(fd, 'failureOnAnswer', true),
        failureSeverity: text(fd, 'failureSeverity'),
        requiresPhotoOnFailure: bool(fd, 'requiresPhotoOnFailure'),
        requiresCommentOnFailure: bool(fd, 'requiresCommentOnFailure'),
        photoOnAnswers: fd.getAll('photoOnAnswers').map(String),
        commentOnAnswers: fd.getAll('commentOnAnswers').map(String),
        photoInstructions: text(fd, 'photoInstructions', true),
        analyticsKey: text(fd, 'analyticsKey', true),
        sortOrder: num(fd, 'sortOrder') ?? 0,
        isActive: bool(fd, 'isActive'),
      };
      await api(id ? `/pm-items/${id}` : `/pm-sections/${sectionId}/items`, { method: id ? 'PATCH' : 'POST', body });
    }
  } catch (e) {
    return failed(e, fd);
  }
  redirect(`/admin/templates/${templateId}`);
}

export async function saveReadingField(_prev: FormState, fd: FormData): Promise<FormState> {
  await requirePermission('pm_templates.manage');
  const templateId = text(fd, 'templateId') ?? '';
  const id = text(fd, 'id');
  const sectionId = text(fd, 'sectionId') ?? '';
  try {
    if (text(fd, 'op') === 'delete' && id) {
      await api(`/pm-reading-fields/${id}`, { method: 'DELETE' });
    } else {
      const body = {
        code: text(fd, 'code') ?? '',
        label: text(fd, 'label') ?? '',
        valueType: text(fd, 'valueType'),
        unit: text(fd, 'unit', true),
        isInteger: bool(fd, 'isInteger'),
        minValue: num(fd, 'minValue'),
        maxValue: num(fd, 'maxValue'),
        options: lines(fd, 'options'),
        isRequired: bool(fd, 'isRequired'),
        helpText: text(fd, 'helpText', true),
        analyticsKey: text(fd, 'analyticsKey', true),
        sortOrder: num(fd, 'sortOrder') ?? 0,
        isActive: bool(fd, 'isActive'),
      };
      await api(id ? `/pm-reading-fields/${id}` : `/pm-sections/${sectionId}/reading-fields`, { method: id ? 'PATCH' : 'POST', body });
    }
  } catch (e) {
    return failed(e, fd);
  }
  redirect(`/admin/templates/${templateId}`);
}

export async function saveRule(_prev: FormState, fd: FormData): Promise<FormState> {
  await requirePermission('pm_templates.manage');
  const id = text(fd, 'id');
  if (id) return submit(fd, () => api(`/pm-consistency-rules/${id}`, { method: 'PATCH', body: { isActive: text(fd, 'isActive') === 'true' } }), 'Rule saved.', ['/admin/templates']);
  return submit(
    fd,
    () => api('/pm-consistency-rules', { body: { lhsKey: text(fd, 'lhsKey') ?? '', operator: text(fd, 'operator'), rhsKey: text(fd, 'rhsKey') ?? '', message: text(fd, 'message') ?? '' } }),
    'Rule added.',
    ['/admin/templates'],
  );
}

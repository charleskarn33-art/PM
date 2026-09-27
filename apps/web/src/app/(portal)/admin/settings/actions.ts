'use server';

import { api } from '@/lib/api/server';
import { requirePermission } from '@/lib/auth';
import { submit, text, type FormState } from '@/lib/form-action';

export async function saveGeofence(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('settings.manage');
  return submit(formData, () => api('/settings/geofence', { method: 'PUT', body: { mode: text(formData, 'mode'), radiusM: Number(text(formData, 'radiusM')) } }), 'Geofence saved. It applies to PMs started from now on.', ['/admin/settings']);
}

export async function savePmRules(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('settings.manage');
  return submit(formData, () => api('/settings/pm', { method: 'PUT', body: { requireSignature: formData.get('requireSignature') === 'on' } }), 'PM rules saved.', ['/admin/settings']);
}

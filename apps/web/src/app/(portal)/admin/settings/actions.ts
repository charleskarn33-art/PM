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

const THRESHOLD_KEYS = ['dcLoadKwMax', 'rectifierVoltageMin', 'batteryVoltageMin', 'batteryUnitVoltageMin', 'fuelLevelMinPct', 'generatorServiceHours', 'completionTargetPct'] as const;

/** Empty fields clear a threshold (nothing is flagged for it). */
export async function saveThresholds(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('settings.manage');
  const body = Object.fromEntries(
    THRESHOLD_KEYS.map((k) => {
      const v = text(formData, k);
      // Not a number: sent as typed, so the API names the field.
      return [k, v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : v];
    }),
  );
  return submit(formData, () => api('/settings/thresholds', { method: 'PUT', body }), 'Thresholds saved. Analytics flags use them from now on.', ['/admin/settings', '/analytics']);
}

export async function saveNotificationSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('settings.manage');
  const days = text(formData, 'pmDueReminderDays');
  const body = {
    pmDueReminderDays: days === undefined ? null : Number.isInteger(Number(days)) ? Number(days) : days,
    actionOverdueAlerts: formData.get('actionOverdueAlerts') === 'on',
  };
  return submit(formData, () => api('/settings/notifications', { method: 'PUT', body }), 'Notification settings saved.', ['/admin/settings']);
}

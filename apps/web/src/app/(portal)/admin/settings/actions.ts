'use server';

import { validateConsistencyRule, validateDcThresholds, validateGeofenceSetting, type Json } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/auth';
import { formValues, type FormValues } from '@/lib/form-values';
import { createClient } from '@/lib/supabase/server';

export interface SettingsFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string | undefined>;
  values?: FormValues;
}

async function writeSetting(key: string, value: Json): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('system_settings').update({ value }).eq('key', key).select('key');
  if (error) return error.message;
  if (!data?.length) return 'Setting not found or not permitted.';
  return null;
}

export async function saveGeofence(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireCapability('manage_settings');
  const values = formValues(formData);
  const result = validateGeofenceSetting(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  const error = await writeSetting('geofence', { ...result.value });
  if (error) return { error: `Unable to save: ${error}`, values };
  revalidatePath('/admin/settings');
  return { success: 'GPS geofence saved. Phones use it after their next sync.' };
}

export async function saveDcThresholds(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireCapability('manage_settings');
  const values = formValues(formData);
  const result = validateDcThresholds(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  const error = await writeSetting('dc_thresholds', { ...result.value });
  if (error) return { error: `Unable to save: ${error}`, values };
  revalidatePath('/admin/settings');
  return { success: 'DC high-load thresholds saved.' };
}

export async function savePmSubmission(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireCapability('manage_settings');
  const enforce = ['on', 'true'].includes(String(formData.get('enforce_photo_requirements') ?? ''));
  const error = await writeSetting('pm_submission', { enforce_photo_requirements: enforce });
  if (error) return { error: `Unable to save: ${error}` };
  revalidatePath('/admin/settings');
  return { success: enforce ? 'Required evidence photos are enforced at submission.' : 'Photo requirements are no longer enforced at submission.' };
}

export async function saveConsistencyRule(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireCapability('manage_settings');
  const values = formValues(formData);
  const id = values.id ?? '';
  const supabase = await createClient();
  const keys = await supabase.from('pm_value_keys').select('analytics_key');
  if (keys.error) return { error: `Unable to load recorded values: ${keys.error.message}`, values };
  const result = validateConsistencyRule(values, new Set((keys.data ?? []).map((k) => k.analytics_key!)));
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  const { error } = id
    ? await supabase.from('pm_consistency_rules').update(result.value).eq('id', id)
    : await supabase.from('pm_consistency_rules').insert(result.value);
  if (error) {
    if (error.code === '23505') return { error: 'An identical rule already exists.', values };
    return { error: `Unable to save rule: ${error.message}`, values };
  }
  revalidatePath('/admin/settings');
  return { success: id ? 'Rule updated.' : 'Rule added. Phones use it after their next sync.' };
}

'use server';

import { isUuid, requiredNote, SEVERITIES, validateCorrectiveAction, validateManualFailure, type Enums } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireCapability } from '@/lib/auth';
import { formValues, type FormValues } from '@/lib/form-values';
import { createClient } from '@/lib/supabase/server';

export interface FormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string | undefined>;
  values?: FormValues;
}

/** Turns database refusals into sentences for the user. */
function dbMessage(message: string): string {
  if (/row-level security|Not permitted/i.test(message)) return 'You are not allowed to do this for this site.';
  return message;
}

export async function createCorrectiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability('manage_corrective_actions');
  const values = formValues(formData);
  const result = validateCorrectiveAction(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  const failureId = values.failure_id ?? '';
  const siteId = values.site_id ?? '';
  const category = values.category as Enums<'pm_category'>;
  if (!isUuid(failureId) || !isUuid(siteId)) return { error: 'Invalid failure.', values };

  const supabase = await createClient();
  // Site, visit and category are taken from the failure by the database.
  const { data, error } = await supabase
    .from('corrective_actions')
    .insert({ ...result.value, failure_id: failureId, site_id: siteId, category })
    .select('id')
    .single();
  if (error) return { error: `Unable to create the corrective action: ${dbMessage(error.message)}`, values };
  revalidatePath(`/failures/${failureId}`);
  revalidatePath('/corrective-actions');
  redirect(`/corrective-actions/${data.id}?created=1`);
}

export async function closeFailure(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability('manage_corrective_actions');
  const values = formValues(formData);
  const id = values.id ?? '';
  const note = requiredNote(values, 'resolution_note', 5);
  if (!note.ok) return { fieldErrors: { resolution_note: note.error }, values };
  const supabase = await createClient();
  const { data, error } = await supabase.from('failures').update({ status: 'CLOSED', resolution_note: note.value }).eq('id', id).select('id');
  if (error) return { error: dbMessage(error.message), values };
  if (!data?.length) return { error: 'You are not allowed to close this failure.', values };
  revalidatePath(`/failures/${id}`);
  return { success: 'Failure closed.' };
}

export async function reopenFailure(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability('manage_corrective_actions');
  const id = String(formData.get('id') ?? '');
  const supabase = await createClient();
  const { data, error } = await supabase.from('failures').update({ status: 'OPEN' }).eq('id', id).select('id');
  if (error) return { error: dbMessage(error.message) };
  if (!data?.length) return { error: 'You are not allowed to reopen this failure.' };
  revalidatePath(`/failures/${id}`);
  return { success: 'Failure reopened.' };
}

export async function updateFailureSeverity(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability('manage_corrective_actions');
  const id = String(formData.get('id') ?? '');
  const severity = String(formData.get('severity') ?? '') as Enums<'severity_level'>;
  if (!SEVERITIES.includes(severity)) return { error: 'Choose a severity.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('failures').update({ severity }).eq('id', id).select('id');
  if (error) return { error: dbMessage(error.message) };
  if (!data?.length) return { error: 'You are not allowed to change this failure.' };
  revalidatePath(`/failures/${id}`);
  return { success: 'Severity updated.' };
}

export async function createManualFailure(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability('manage_corrective_actions');
  const values = formValues(formData);
  const result = validateManualFailure(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('failures')
    .insert({ ...result.value, source: 'MANUAL' })
    .select('id')
    .single();
  if (error) return { error: `Unable to record the failure: ${dbMessage(error.message)}`, values };
  revalidatePath('/failures');
  redirect(`/failures/${data.id}`);
}

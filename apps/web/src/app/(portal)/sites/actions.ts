'use server';

import { toIsoDate, validateSite, type FieldErrors, type SiteField } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireCapability, requireSession } from '@/lib/auth';
import { formValues, type FormValues } from '@/lib/form-values';
import { createClient } from '@/lib/supabase/server';

export interface SiteFormState {
  error?: string;
  fieldErrors?: FieldErrors<SiteField>;
  values?: FormValues;
}

export async function saveSite(_prev: SiteFormState, formData: FormData): Promise<SiteFormState> {
  await requireCapability('manage_organization');
  const id = String(formData.get('id') ?? '');
  const values = formValues(formData);
  const result = validateSite(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };

  const supabase = await createClient();
  const query = id
    ? supabase.from('sites').update(result.value).eq('id', id).select('id').single()
    : supabase.from('sites').insert(result.value).select('id').single();
  const { data, error } = await query;
  if (error) {
    if (error.code === '23505') return { fieldErrors: { site_code: 'This Site ID already exists.' }, values };
    return { error: `Unable to save the site: ${error.message}`, values };
  }
  revalidatePath('/sites');
  redirect(`/sites/${data.id}`);
}

export interface AssignmentState {
  error?: string;
  success?: string;
}

export async function assignTechnician(_prev: AssignmentState, formData: FormData): Promise<AssignmentState> {
  await requireCapability('manage_assignments');
  const siteId = String(formData.get('site_id') ?? '');
  const technicianId = String(formData.get('technician_id') ?? '');
  const startsOn = String(formData.get('starts_on') ?? '') || toIsoDate(new Date());
  if (!technicianId) return { error: 'Select a technician.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('site_assignments')
    .insert({ site_id: siteId, technician_id: technicianId, starts_on: startsOn });
  if (error) {
    if (error.code === '23505') return { error: 'This technician is already assigned to the site.' };
    if (error.code === '42501') return { error: 'You are not allowed to manage assignments for this site.' };
    return { error: `Unable to assign technician: ${error.message}` };
  }
  revalidatePath(`/sites/${siteId}`);
  return { success: 'Technician assigned.' };
}

export async function endAssignment(formData: FormData): Promise<void> {
  await requireSession();
  const id = String(formData.get('assignment_id') ?? '');
  const siteId = String(formData.get('site_id') ?? '');
  const supabase = await createClient();
  const { error } = await supabase
    .from('site_assignments')
    .update({ is_active: false, ends_on: toIsoDate(new Date()) })
    .eq('id', id);
  if (error) throw new Error(`Unable to end the assignment: ${error.message}`);
  revalidatePath(`/sites/${siteId}`);
}

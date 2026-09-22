'use server';

import { isUuid, validateChecklistItem, validateReadingField, validateSection } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireCapability } from '@/lib/auth';
import { formValues, type FormValues } from '@/lib/form-values';
import { createClient } from '@/lib/supabase/server';

export interface TemplateFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string | undefined>;
  values?: FormValues;
}

function friendly(message: string): string {
  if (/Retired template/.test(message)) return 'This template version is retired and read-only. Create a new version to make changes.';
  if (/duplicate key/.test(message)) return 'This code is already used in this section.';
  return message;
}

export async function cloneTemplate(formData: FormData): Promise<void> {
  await requireCapability('manage_templates');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_clone_template', { p_template_id: String(formData.get('template_id')) });
  if (error) throw new Error(`Unable to create a new version: ${error.message}`);
  revalidatePath('/admin/templates');
  redirect(`/admin/templates/${data}`);
}

export async function activateTemplate(formData: FormData): Promise<void> {
  await requireCapability('manage_templates');
  const id = String(formData.get('template_id'));
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_activate_template', { p_template_id: id });
  if (error) throw new Error(`Unable to activate: ${error.message}`);
  revalidatePath('/admin/templates');
  revalidatePath(`/admin/templates/${id}`);
}

export async function saveItem(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  await requireCapability('manage_templates');
  const values = formValues(formData);
  const { template_id: templateId, section_id: sectionId, id } = values;
  const result = validateChecklistItem(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  if (!isUuid(sectionId) || !isUuid(templateId)) return { error: 'Invalid section.', values };

  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from('pm_checklist_items').update(result.value).eq('id', id);
    if (error) return { error: `Unable to save: ${friendly(error.message)}`, values };
  } else {
    const { data: last } = await supabase
      .from('pm_checklist_items')
      .select('sort_order')
      .eq('section_id', sectionId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from('pm_checklist_items')
      .insert({ ...result.value, section_id: sectionId, sort_order: (last?.sort_order ?? 0) + 1 });
    if (error) return { error: `Unable to add: ${friendly(error.message)}`, values };
  }
  revalidatePath(`/admin/templates/${templateId}`);
  redirect(`/admin/templates/${templateId}#section-${sectionId}`);
}

export async function saveReading(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  await requireCapability('manage_templates');
  const values = formValues(formData);
  const { template_id: templateId, section_id: sectionId, id } = values;
  const result = validateReadingField(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  if (!isUuid(sectionId) || !isUuid(templateId)) return { error: 'Invalid section.', values };

  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from('pm_reading_fields').update(result.value).eq('id', id);
    if (error) return { error: `Unable to save: ${friendly(error.message)}`, values };
  } else {
    const { data: last } = await supabase
      .from('pm_reading_fields')
      .select('sort_order')
      .eq('section_id', sectionId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from('pm_reading_fields')
      .insert({ ...result.value, section_id: sectionId, sort_order: (last?.sort_order ?? 0) + 1 });
    if (error) return { error: `Unable to add: ${friendly(error.message)}`, values };
  }
  revalidatePath(`/admin/templates/${templateId}`);
  redirect(`/admin/templates/${templateId}#section-${sectionId}`);
}

export async function saveSection(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  await requireCapability('manage_templates');
  const values = formValues(formData);
  const result = validateSection(values);
  if (!result.ok) return { error: result.errors.name, values };
  const supabase = await createClient();
  const { error } = await supabase.from('pm_sections').update(result.value).eq('id', values.id ?? '');
  if (error) return { error: `Unable to save: ${friendly(error.message)}`, values };
  revalidatePath(`/admin/templates/${values.template_id}`);
  return { success: 'Section saved.' };
}

/** Swap an item (or reading) with its neighbour to reorder. */
export async function moveEntry(formData: FormData): Promise<void> {
  await requireCapability('manage_templates');
  const table = formData.get('kind') === 'reading' ? 'pm_reading_fields' : 'pm_checklist_items';
  const id = String(formData.get('id'));
  const direction = formData.get('direction') === 'up' ? 'up' : 'down';
  const templateId = String(formData.get('template_id'));
  const supabase = await createClient();

  const { data: current, error } = await supabase.from(table).select('id, section_id, sort_order').eq('id', id).single();
  if (error) throw new Error(error.message);
  const neighbourQuery = supabase
    .from(table)
    .select('id, sort_order')
    .eq('section_id', current.section_id)
    .order('sort_order', { ascending: direction === 'down' })
    .limit(1);
  const { data: neighbour } = await (direction === 'up'
    ? neighbourQuery.lt('sort_order', current.sort_order)
    : neighbourQuery.gt('sort_order', current.sort_order)
  ).maybeSingle();
  if (!neighbour) return;
  const first = await supabase.from(table).update({ sort_order: neighbour.sort_order }).eq('id', current.id);
  const second = await supabase.from(table).update({ sort_order: current.sort_order }).eq('id', neighbour.id);
  if (first.error || second.error) throw new Error(friendly((first.error ?? second.error)!.message));
  revalidatePath(`/admin/templates/${templateId}`);
}

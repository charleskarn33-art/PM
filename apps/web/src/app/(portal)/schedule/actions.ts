'use server';

import { isUuid, validateSchedule, type Enums } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireCapability } from '@/lib/auth';
import { formValues, type FormValues } from '@/lib/form-values';
import { createClient } from '@/lib/supabase/server';

export interface ScheduleFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string | undefined>;
  values?: FormValues;
}

function dbMessage(message: string): string {
  if (/not assigned to this site/.test(message)) return 'The technician is not assigned to this site. Assign them on the site page first.';
  if (/ACTIVE template/.test(message)) return 'PM can only be scheduled with the active template version.';
  if (/row-level security/.test(message)) return 'You are not allowed to schedule PM for this site.';
  return message;
}

export async function createSchedules(_prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireCapability('schedule_pm');
  const values = formValues(formData);
  const result = validateSchedule(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  const templateId = values.template_id;
  if (!isUuid(templateId)) return { error: 'Select a PM template.', values };

  const { site_id, technician_id, frequency, priority, notes, occurrences } = result.value;
  const supabase = await createClient();
  const { error } = await supabase.from('pm_schedules').insert(
    occurrences.map((o) => ({ site_id, technician_id, frequency, priority, notes, template_id: templateId, ...o })),
  );
  if (error) return { error: `Unable to create the schedule: ${dbMessage(error.message)}`, values };
  revalidatePath('/schedule');
  redirect(`/schedule?created=${occurrences.length}`);
}

export async function updateSchedule(_prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireCapability('schedule_pm');
  const values = formValues(formData);
  const id = values.id ?? '';
  const scheduled = values.scheduled_date ?? '';
  const due = values.due_date ?? '';
  const technician = values.technician_id || null;
  const priority = values.priority as Enums<'priority_level'>;
  if (!isUuid(id)) return { error: 'Invalid schedule.' };
  if (technician && !isUuid(technician)) return { error: 'Invalid technician.', values };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduled) || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: 'Enter valid dates.', values };
  if (due < scheduled) return { fieldErrors: { due_date: 'Due date must be on or after the scheduled date.' }, values };

  const supabase = await createClient();
  const { error } = await supabase
    .from('pm_schedules')
    .update({ scheduled_date: scheduled, due_date: due, technician_id: technician, priority, notes: values.notes?.trim() || null })
    .eq('id', id);
  if (error) return { error: `Unable to save: ${dbMessage(error.message)}`, values };
  revalidatePath(`/schedule/${id}`);
  revalidatePath('/schedule');
  return { success: 'Schedule updated.' };
}

export async function cancelSchedule(formData: FormData): Promise<void> {
  await requireCapability('schedule_pm');
  const id = String(formData.get('id') ?? '');
  const supabase = await createClient();
  const { error } = await supabase
    .from('pm_schedules')
    .update({ status: 'CANCELLED' })
    .eq('id', id)
    .in('status', ['SCHEDULED', 'OVERDUE']);
  if (error) throw new Error(`Unable to cancel the schedule: ${dbMessage(error.message)}`);
  revalidatePath(`/schedule/${id}`);
  revalidatePath('/schedule');
}

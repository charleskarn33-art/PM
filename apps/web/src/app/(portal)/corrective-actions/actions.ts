'use server';

import { isUuid, requiredNote, validateCorrectiveAction, type Enums } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { formValues, type FormValues } from '@/lib/form-values';
import { createClient } from '@/lib/supabase/server';

export interface ActionFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string | undefined>;
  values?: FormValues;
}

function dbMessage(message: string): string {
  if (/row-level security|Only the assignee or a supervisor/i.test(message)) return 'You are not allowed to change this corrective action.';
  return message;
}

function refresh(id: string) {
  revalidatePath(`/corrective-actions/${id}`);
  revalidatePath('/corrective-actions');
}

/** Supervisor edit: description, priority, assignee, due date. The database decides who may do it. */
export async function updateCorrectiveAction(_prev: ActionFormState, formData: FormData): Promise<ActionFormState> {
  await requireSession();
  const values = formValues(formData);
  const id = values.id ?? '';
  if (!isUuid(id)) return { error: 'Invalid corrective action.' };
  const result = validateCorrectiveAction(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  const supabase = await createClient();
  const { data, error } = await supabase.from('corrective_actions').update(result.value).eq('id', id).select('id');
  if (error) return { error: dbMessage(error.message), values };
  if (!data?.length) return { error: 'You are not allowed to change this corrective action.', values };
  refresh(id);
  return { success: 'Saved.' };
}

const TARGETS: Enums<'corrective_action_status'>[] = ['IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];

/** Moves the workflow forward: start, complete (with resolution), verify, close. */
export async function changeActionStatus(_prev: ActionFormState, formData: FormData): Promise<ActionFormState> {
  await requireSession();
  const values = formValues(formData);
  const id = values.id ?? '';
  const status = values.status as Enums<'corrective_action_status'>;
  if (!isUuid(id) || !TARGETS.includes(status)) return { error: 'Invalid request.' };
  const patch: { status: Enums<'corrective_action_status'>; resolution?: string } = { status };
  // Closing before verification (cancelling the work) needs a reason on the timeline.
  let note: string | null = null;
  if (values.require_note === '1') {
    const n = requiredNote(values, 'note', 5);
    if (!n.ok) return { fieldErrors: { note: n.error }, values };
    note = n.value;
  }
  if (status === 'COMPLETED') {
    const note = requiredNote(values, 'resolution', 5);
    if (!note.ok) return { fieldErrors: { resolution: note.error }, values };
    patch.resolution = note.value;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from('corrective_actions').update(patch).eq('id', id).select('id');
  if (error) return { error: dbMessage(error.message), values };
  if (!data?.length) return { error: 'You are not allowed to change this corrective action.', values };
  if (note) {
    const { error: noteError } = await supabase.from('corrective_action_updates').insert({ corrective_action_id: id, note });
    if (noteError) return { error: `Status changed, but the note was not saved: ${noteError.message}` };
  }
  refresh(id);
  // The controls for the old status disappear, so confirm on the page itself.
  redirect(`/corrective-actions/${id}?done=${status}`);
}

export async function returnCorrectiveAction(_prev: ActionFormState, formData: FormData): Promise<ActionFormState> {
  await requireSession();
  const values = formValues(formData);
  const id = values.id ?? '';
  const note = requiredNote(values, 'note', 5);
  if (!note.ok) return { fieldErrors: { note: note.error }, values };
  const supabase = await createClient();
  const { error } = await supabase.rpc('return_corrective_action', { p_action_id: id, p_note: note.value });
  if (error) return { error: dbMessage(error.message), values };
  refresh(id);
  redirect(`/corrective-actions/${id}?done=RETURNED`);
}

export async function addActionNote(_prev: ActionFormState, formData: FormData): Promise<ActionFormState> {
  await requireSession();
  const values = formValues(formData);
  const id = values.id ?? '';
  const note = requiredNote(values, 'note', 2);
  if (!note.ok) return { fieldErrors: { note: note.error }, values };
  const supabase = await createClient();
  const { error } = await supabase.from('corrective_action_updates').insert({ corrective_action_id: id, note: note.value });
  if (error) return { error: dbMessage(error.message), values };
  refresh(id);
  return { success: 'Note added.' };
}

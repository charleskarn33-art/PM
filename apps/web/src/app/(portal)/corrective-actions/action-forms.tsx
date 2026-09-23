'use client';

import { humanizeStatus, PRIORITIES, ROLE_LABELS, type AppRole } from '@ipt/shared';
import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { addActionNote, changeActionStatus, returnCorrectiveAction, updateCorrectiveAction, type ActionFormState } from './actions';

function Messages({ state }: { state: ActionFormState }) {
  return (
    <>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </>
  );
}
const FieldError = ({ message }: { message?: string }) => (message ? <p className="text-xs text-danger">{message}</p> : null);

export function EditActionForm({
  action: a,
  assignees,
}: {
  action: { id: string; description: string; priority: string; assigned_to: string | null; due_date: string | null };
  assignees: { id: string; full_name: string; role: AppRole }[];
}) {
  const [state, action, pending] = useActionState<ActionFormState, FormData>(updateCorrectiveAction, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const options = a.assigned_to && !assignees.some((x) => x.id === a.assigned_to) ? [{ id: a.assigned_to, full_name: 'Current assignee', role: 'technician' as AppRole }, ...assignees] : assignees;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={a.id} />
      <Messages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="edit-description">Work to be done</Label>
        <Textarea id="edit-description" name="description" required defaultValue={v?.description ?? a.description} />
        <FieldError message={e.description} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-assignee">Assigned to</Label>
          <FormSelect id="edit-assignee" name="assigned_to" defaultValue={v?.assigned_to ?? a.assigned_to ?? ''}>
            <option value="">Not assigned</option>
            {options.map((x) => (
              <option key={x.id} value={x.id}>
                {x.full_name} ({ROLE_LABELS[x.role]})
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.assigned_to} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-priority">Priority</Label>
          <FormSelect id="edit-priority" name="priority" defaultValue={v?.priority ?? a.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {humanizeStatus(p)}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-due">Due date</Label>
          <Input id="edit-due" name="due_date" type="date" defaultValue={v?.due_date ?? a.due_date ?? ''} />
          <FieldError message={e.due_date} />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Save changes
      </Button>
    </form>
  );
}

/** One-click status change (start work, verify, close after verification). */
export function StatusButton({ id, status, label, variant }: { id: string; status: string; label: string; variant?: 'outline' }) {
  const [state, action, pending] = useActionState<ActionFormState, FormData>(changeActionStatus, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Messages state={state} />
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>
    </form>
  );
}

export function CompleteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionFormState, FormData>(changeActionStatus, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="COMPLETED" />
      <Messages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="resolution">What was done</Label>
        <Textarea id="resolution" name="resolution" required defaultValue={state.values?.resolution} placeholder="Parts replaced, tests performed, readings after repair" />
        <FieldError message={e.resolution} />
      </div>
      <Button type="submit" disabled={pending}>
        Mark completed
      </Button>
    </form>
  );
}

export function CloseWithNoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionFormState, FormData>(changeActionStatus, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="CLOSED" />
      <input type="hidden" name="require_note" value="1" />
      <Messages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="close-note">Reason for closing without completing the work</Label>
        <Textarea id="close-note" name="note" defaultValue={state.values?.note} placeholder="e.g. Raised in error; covered by CA-000031" />
        <FieldError message={e.note} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Close action
      </Button>
    </form>
  );
}

export function ReturnForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionFormState, FormData>(returnCorrectiveAction, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Messages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="return-note">What still needs to be done</Label>
        <Textarea id="return-note" name="note" defaultValue={state.values?.note} />
        <FieldError message={e.note} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Return to assignee
      </Button>
    </form>
  );
}

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionFormState, FormData>(addActionNote, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Messages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="note">Add a note</Label>
        <Textarea id="note" name="note" defaultValue={state.success ? '' : state.values?.note} key={state.success ?? 'note'} />
        <FieldError message={e.note} />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Add note
      </Button>
    </form>
  );
}

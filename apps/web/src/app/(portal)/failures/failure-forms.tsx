'use client';

import { humanizeStatus, PM_CATEGORIES, PM_CATEGORY_LABELS, PRIORITIES, ROLE_LABELS, SEVERITIES, type AppRole } from '@ipt/shared';
import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { closeFailure, createCorrectiveAction, createManualFailure, reopenFailure, updateFailureSeverity, type FormState } from './actions';

function Messages({ state }: { state: FormState }) {
  return (
    <>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </>
  );
}
const FieldError = ({ message }: { message?: string }) => (message ? <p className="text-xs text-danger">{message}</p> : null);

export interface AssigneeOption {
  id: string;
  full_name: string;
  role: AppRole;
}

export function CreateActionForm({
  failure,
  assignees,
  defaults,
}: {
  failure: { id: string; site_id: string; category: string };
  assignees: AssigneeOption[];
  defaults: { description: string; priority: string };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createCorrectiveAction, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="failure_id" value={failure.id} />
      <input type="hidden" name="site_id" value={failure.site_id} />
      <input type="hidden" name="category" value={failure.category} />
      <Messages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="ca-description">Work to be done</Label>
        <Textarea id="ca-description" name="description" required defaultValue={v?.description ?? defaults.description} aria-invalid={Boolean(e.description) || undefined} />
        <FieldError message={e.description} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="ca-assignee">Assign to</Label>
          <FormSelect id="ca-assignee" name="assigned_to" defaultValue={v?.assigned_to ?? ''}>
            <option value="">Not assigned yet</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name} ({ROLE_LABELS[a.role]})
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.assigned_to} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ca-priority">Priority</Label>
          <FormSelect id="ca-priority" name="priority" defaultValue={v?.priority ?? defaults.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {humanizeStatus(p)}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.priority} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ca-due">Due date</Label>
          <Input id="ca-due" name="due_date" type="date" defaultValue={v?.due_date ?? ''} aria-invalid={Boolean(e.due_date) || undefined} />
          <FieldError message={e.due_date} />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        Create corrective action
      </Button>
    </form>
  );
}

export function CloseFailureForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(closeFailure, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Messages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="close-note">Reason for closing without further work</Label>
        <Textarea id="close-note" name="resolution_note" placeholder="e.g. Duplicate of FL-000012; false alarm confirmed on site" defaultValue={state.values?.resolution_note} aria-invalid={Boolean(e.resolution_note) || undefined} />
        <FieldError message={e.resolution_note} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Close failure
      </Button>
    </form>
  );
}

export function ReopenFailureForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reopenFailure, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Messages state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        Reopen failure
      </Button>
    </form>
  );
}

export function SeverityForm({ id, severity }: { id: string; severity: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateFailureSeverity, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="space-y-1.5">
        <Label htmlFor="severity">Severity</Label>
        <FormSelect id="severity" name="severity" defaultValue={severity} className="w-40">
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </FormSelect>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Update
      </Button>
      <div className="basis-full">
        <Messages state={state} />
      </div>
    </form>
  );
}

export function ManualFailureForm({ sites }: { sites: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createManualFailure, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <Messages state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="mf-site">Site</Label>
          <FormSelect id="mf-site" name="site_id" defaultValue={v?.site_id ?? ''} required>
            <option value="" disabled>
              Select…
            </option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.site_id} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mf-category">Section</Label>
          <FormSelect id="mf-category" name="category" defaultValue={v?.category ?? ''} required>
            <option value="" disabled>
              Select…
            </option>
            {PM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PM_CATEGORY_LABELS[c]}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.category} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mf-severity">Severity</Label>
          <FormSelect id="mf-severity" name="severity" defaultValue={v?.severity ?? ''} required>
            <option value="" disabled>
              Select…
            </option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {humanizeStatus(s)}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.severity} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mf-description">What is wrong</Label>
        <Textarea id="mf-description" name="description" required defaultValue={v?.description} aria-invalid={Boolean(e.description) || undefined} />
        <FieldError message={e.description} />
      </div>
      <Button type="submit" disabled={pending}>
        Record failure
      </Button>
    </form>
  );
}

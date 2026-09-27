'use client';

import { humanizeStatus } from '@ipt/shared';
import { useActionState } from 'react';
import { FieldError, FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { FormState } from '@/lib/form-action';
import { actionStep, updateAction } from './actions';

type Ids = { id: string; failureId: string };

function Hidden({ id, failureId, step }: Ids & { step: string }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="failureId" value={failureId} />
      <input type="hidden" name="step" value={step} />
    </>
  );
}

export function StartForm(ids: Ids) {
  const [state, action, pending] = useActionState<FormState, FormData>(actionStep, {});
  return (
    <form action={action} className="space-y-2">
      <Hidden {...ids} step="start" />
      <FormMessages state={state} />
      <Button type="submit" disabled={pending}>
        Start work
      </Button>
    </form>
  );
}

export function CompleteForm(ids: Ids) {
  const [state, action, pending] = useActionState<FormState, FormData>(actionStep, {});
  return (
    <form action={action} className="space-y-2">
      <Hidden {...ids} step="complete" />
      <FormMessages state={state} />
      <Label htmlFor="c-note">What was done</Label>
      <Textarea id="c-note" name="note" required maxLength={2000} defaultValue={state.values?.note} />
      <Button type="submit" disabled={pending}>
        Mark completed
      </Button>
    </form>
  );
}

export function VerifyForm(ids: Ids) {
  const [state, action, pending] = useActionState<FormState, FormData>(actionStep, {});
  return (
    <form action={action} className="space-y-2">
      <Hidden {...ids} step="verify" />
      <FormMessages state={state} />
      <Label htmlFor="v-note">Verification note</Label>
      <Textarea id="v-note" name="note" maxLength={2000} placeholder="Required when sending it back: what must be redone?" defaultValue={state.values?.note} />
      <FieldError message={state.fieldErrors?.note} />
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="APPROVE" disabled={pending}>
          Verify
        </Button>
        <Button type="submit" name="decision" value="REJECT" variant="destructive" disabled={pending}>
          Send back
        </Button>
      </div>
    </form>
  );
}

export function CloseForm({ withdraw, ...ids }: Ids & { withdraw: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(actionStep, {});
  return (
    <form action={action} className="space-y-2">
      <Hidden {...ids} step="close" />
      <FormMessages state={state} />
      <Label htmlFor="x-note">{withdraw ? 'Why is it withdrawn?' : 'Closing note (optional)'}</Label>
      <Textarea id="x-note" name="note" required={withdraw} maxLength={2000} defaultValue={state.values?.note} />
      <Button type="submit" variant={withdraw ? 'outline' : 'default'} disabled={pending}>
        {withdraw ? 'Withdraw action' : 'Close action'}
      </Button>
    </form>
  );
}

export function AssignForm({ assignees, current, dueDate, ...ids }: Ids & { assignees: { id: string; label: string }[]; current: string | null; dueDate: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(actionStep, {});
  return (
    <form action={action} className="space-y-2">
      <Hidden {...ids} step="assign" />
      <FormMessages state={state} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="as-user">{current ? 'Reassign to' : 'Assign to'}</Label>
          <FormSelect id="as-user" name="assignedToId" required defaultValue={state.values?.assignedToId ?? current ?? ''}>
            <option value="" disabled>
              Select…
            </option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="as-due">Due date</Label>
          <Input id="as-due" name="dueDate" type="date" defaultValue={state.values?.dueDate ?? dueDate ?? ''} />
        </div>
      </div>
      <Button type="submit" variant="outline" disabled={pending || assignees.length === 0}>
        {current ? 'Reassign' : 'Assign'}
      </Button>
    </form>
  );
}

export function EditActionForm({ action: a }: { action: { id: string; title: string; description: string | null; priority: string; dueDate: string | null } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateAction, {});
  const v = (k: string, d: string | null) => state.values?.[k] ?? d ?? '';
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={a.id} />
      <FormMessages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="e-title">Work to be done</Label>
        <Input id="e-title" name="title" required maxLength={255} defaultValue={v('title', a.title)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="e-description">Details</Label>
        <Textarea id="e-description" name="description" maxLength={4000} defaultValue={v('description', a.description)} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="e-priority">Priority</Label>
          <FormSelect id="e-priority" name="priority" defaultValue={v('priority', a.priority)}>
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
              <option key={p} value={p}>
                {humanizeStatus(p)}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e-due">Due date</Label>
          <Input id="e-due" name="dueDate" type="date" defaultValue={v('dueDate', a.dueDate)} />
        </div>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

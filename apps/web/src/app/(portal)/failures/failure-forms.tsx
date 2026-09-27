'use client';

import { humanizeStatus } from '@ipt/shared';
import { useActionState, useState } from 'react';
import { FieldError, FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { FormState } from '@/lib/form-action';
import { addComment, closeOrReopenFailure, createAction, removeAttachment, reportFailure, updateFailure, uploadAttachment } from './actions';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const CATEGORIES = [
  ['GENERATOR', 'Generator'],
  ['DC_SYSTEM', 'DC system'],
  ['BATTERY', 'Battery'],
  ['SOLAR', 'Solar'],
  ['NON_TECHNICAL', 'Non-technical'],
  ['EARTHING', 'Earthing'],
  ['OTHER', 'Other'],
] as const;

/** A random id per form, so a resubmitted request is not recorded twice. */
function useRequestId() {
  const [id] = useState(() => crypto.randomUUID());
  return id;
}

export function ReportFailureForm({ sites, siteId }: { sites: { id: string; label: string }[]; siteId?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reportFailure, {});
  const requestId = useRequestId();
  const e = state.fieldErrors ?? {};
  const v = (k: string, d = '') => state.values?.[k] ?? d;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="requestId" value={requestId} />
      <FormMessages state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="siteId">Site</Label>
          <FormSelect id="siteId" name="siteId" required defaultValue={v('siteId', siteId ?? '')}>
            <option value="">Select site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.siteId} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="severity">Severity</Label>
          <FormSelect id="severity" name="severity" defaultValue={v('severity', 'MEDIUM')}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {humanizeStatus(s)}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="title">What is wrong</Label>
          <Input id="title" name="title" required maxLength={500} defaultValue={v('title')} />
          <FieldError message={e.title} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="description">Details</Label>
          <Textarea id="description" name="description" maxLength={4000} defaultValue={v('description')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Area</Label>
          <FormSelect id="category" name="category" defaultValue={v('category')}>
            <option value="">Not specified</option>
            {CATEGORIES.map(([c, l]) => (
              <option key={c} value={c}>
                {l}
              </option>
            ))}
          </FormSelect>
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        Report failure
      </Button>
    </form>
  );
}

export function EditFailureForm({ failure }: { failure: { id: string; title: string; description: string | null; severity: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateFailure, {});
  const v = (k: string, d: string | null) => state.values?.[k] ?? d ?? '';
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={failure.id} />
      <FormMessages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="f-title">Title</Label>
        <Input id="f-title" name="title" required maxLength={500} defaultValue={v('title', failure.title)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="f-description">Description</Label>
        <Textarea id="f-description" name="description" maxLength={4000} defaultValue={v('description', failure.description)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="f-severity">Severity</Label>
        <FormSelect id="f-severity" name="severity" defaultValue={v('severity', failure.severity)}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </FormSelect>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export function CloseReopenForm({ id, closed }: { id: string; closed: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(closeOrReopenFailure, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={closed ? 'reopen' : 'close'} />
      <FormMessages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="note">{closed ? 'Why is it reopened?' : 'Why is it closed?'}</Label>
        <Textarea id="note" name="note" required maxLength={2000} placeholder={closed ? 'e.g. The fault came back' : 'e.g. Fixed by the vendor under warranty'} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {closed ? 'Reopen failure' : 'Close failure'}
      </Button>
    </form>
  );
}

export function CommentForm({ failureId, actionId }: { failureId: string; actionId?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addComment, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={failureId} />
      {actionId ? <input type="hidden" name="correctiveActionId" value={actionId} /> : null}
      <FormMessages state={state} />
      <Label htmlFor="body" className="sr-only">
        Comment
      </Label>
      <Textarea id="body" name="body" required maxLength={4000} placeholder="Add a comment" defaultValue={state.values?.body} />
      <Button type="submit" size="sm" disabled={pending}>
        Add comment
      </Button>
    </form>
  );
}

export function AttachmentForm({ failureId, actionId }: { failureId: string; actionId?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadAttachment, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={failureId} />
      {actionId ? <input type="hidden" name="correctiveActionId" value={actionId} /> : null}
      <FormMessages state={state} />
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="file">Photo or PDF</Label>
          <Input id="file" name="file" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="caption">Caption</Label>
          <Input id="caption" name="caption" maxLength={255} />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          Attach
        </Button>
      </div>
    </form>
  );
}

export function RemoveAttachmentButton({ failureId, attachmentId }: { failureId: string; attachmentId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(removeAttachment, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={failureId} />
      <input type="hidden" name="attachmentId" value={attachmentId} />
      <button type="submit" disabled={pending} className="text-xs text-danger hover:underline">
        Remove
      </button>
      {state.error ? <span className="ml-2 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

export function CreateActionForm({ failureId, assignees, title }: { failureId: string; assignees: { id: string; label: string }[]; title: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createAction, {});
  const requestId = useRequestId();
  const e = state.fieldErrors ?? {};
  const v = (k: string, d = '') => state.values?.[k] ?? d;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="failureId" value={failureId} />
      <input type="hidden" name="requestId" value={requestId} />
      <FormMessages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="a-title">Work to be done</Label>
        <Input id="a-title" name="title" required maxLength={255} defaultValue={v('title', title)} />
        <FieldError message={e.title} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a-description">Details</Label>
        <Textarea id="a-description" name="description" maxLength={4000} defaultValue={v('description')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="a-assignee">Assign to</Label>
          <FormSelect id="a-assignee" name="assignedToId" defaultValue={v('assignedToId')}>
            <option value="">Not assigned yet</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.assignedToId} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-priority">Priority</Label>
          <FormSelect id="a-priority" name="priority" defaultValue={v('priority', 'MEDIUM')}>
            {SEVERITIES.map((p) => (
              <option key={p} value={p}>
                {humanizeStatus(p)}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-due">Due date</Label>
          <Input id="a-due" name="dueDate" type="date" defaultValue={v('dueDate')} />
          <FieldError message={e.dueDate} />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        Create corrective action
      </Button>
    </form>
  );
}

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
import { cancelSchedule, createSchedule, updateSchedule } from './actions';

const FREQUENCIES = ['AD_HOC', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

interface Option {
  id: string;
  label: string;
}

export function NewScheduleForm({ sites, technicians, templates, today, siteId }: { sites: Option[]; technicians: Option[]; templates: { code: string; label: string }[]; today: string; siteId?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createSchedule, {});
  const e = state.fieldErrors ?? {};
  const v = (k: string, d = '') => state.values?.[k] ?? d;
  return (
    <form action={action} className="space-y-4">
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
          <Label htmlFor="technicianId">Technician</Label>
          <FormSelect id="technicianId" name="technicianId" defaultValue={v('technicianId')}>
            <option value="">Not assigned yet</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </FormSelect>
          <p className="text-xs text-muted-foreground">Must be assigned to the site.</p>
          <FieldError message={e.technicianId} />
        </div>
        {templates.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="templateCode">Checklist</Label>
            <FormSelect id="templateCode" name="templateCode" defaultValue={v('templateCode', templates[0]?.code)}>
              {templates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </FormSelect>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <FormSelect id="priority" name="priority" defaultValue={v('priority', 'MEDIUM')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {humanizeStatus(p)}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheduledDate">Scheduled date</Label>
          <Input id="scheduledDate" name="scheduledDate" type="date" required defaultValue={v('scheduledDate', today)} />
          <FieldError message={e.scheduledDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dueDate">Due date</Label>
          <Input id="dueDate" name="dueDate" type="date" required defaultValue={v('dueDate', today)} />
          <FieldError message={e.dueDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="frequency">Repeats</Label>
          <FormSelect id="frequency" name="frequency" defaultValue={v('frequency', 'MONTHLY')}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {humanizeStatus(f)}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="occurrences">Occurrences to create</Label>
          <Input id="occurrences" name="occurrences" type="number" min={1} max={24} defaultValue={v('occurrences', '1')} />
          <p className="text-xs text-muted-foreground">Each keeps the same gap between scheduled and due date.</p>
          <FieldError message={e.occurrences} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" maxLength={1000} defaultValue={v('notes')} />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        Schedule PM
      </Button>
    </form>
  );
}

export function EditScheduleForm({
  schedule,
  technicians,
}: {
  schedule: { id: string; technicianId: string | null; scheduledDate: string; dueDate: string; priority: string; notes: string | null };
  technicians: Option[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateSchedule, {});
  const e = state.fieldErrors ?? {};
  const v = (k: string, d: string | null) => state.values?.[k] ?? d ?? '';
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={schedule.id} />
      <FormMessages state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="e-technicianId">Technician</Label>
          <FormSelect id="e-technicianId" name="technicianId" defaultValue={v('technicianId', schedule.technicianId)}>
            <option value="">Not assigned</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.technicianId} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e-priority">Priority</Label>
          <FormSelect id="e-priority" name="priority" defaultValue={v('priority', schedule.priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {humanizeStatus(p)}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e-scheduledDate">Scheduled date</Label>
          <Input id="e-scheduledDate" name="scheduledDate" type="date" required defaultValue={v('scheduledDate', schedule.scheduledDate)} />
          <FieldError message={e.scheduledDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e-dueDate">Due date</Label>
          <Input id="e-dueDate" name="dueDate" type="date" required defaultValue={v('dueDate', schedule.dueDate)} />
          <FieldError message={e.dueDate} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="e-notes">Notes</Label>
          <Textarea id="e-notes" name="notes" maxLength={1000} defaultValue={v('notes', schedule.notes)} />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        Save changes
      </Button>
    </form>
  );
}

export function CancelScheduleForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelSchedule, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <FormMessages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason</Label>
        <Input id="reason" name="reason" required maxLength={255} placeholder="e.g. Site decommissioned" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Cancel this PM
      </Button>
    </form>
  );
}

'use client';

import { MAX_OCCURRENCES } from '@ipt/shared';
import { Loader2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createSchedules, type ScheduleFormState } from '../actions';

interface Props {
  sites: { id: string; label: string }[];
  technicians: Record<string, { id: string; name: string }[]>;
  templates: { id: string; label: string }[];
  today: string;
  initialSiteId?: string;
}

const FREQUENCIES = [
  ['MONTHLY', 'Monthly'],
  ['BIMONTHLY', 'Every 2 months'],
  ['QUARTERLY', 'Quarterly'],
  ['SEMIANNUAL', 'Every 6 months'],
  ['ANNUAL', 'Annual'],
  ['WEEKLY', 'Weekly'],
  ['BIWEEKLY', 'Every 2 weeks'],
  ['AD_HOC', 'One-off (ad hoc)'],
] as const;

export function ScheduleForm({ sites, technicians, templates, today, initialSiteId }: Props) {
  const [state, action, pending] = useActionState<ScheduleFormState, FormData>(createSchedules, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [siteId, setSiteId] = useState(v.site_id ?? initialSiteId ?? '');
  const siteTechs = technicians[siteId] ?? [];

  return (
    <form action={action} className="space-y-5">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="site_id">Site</Label>
          <FormSelect id="site_id" name="site_id" defaultValue={siteId} onChange={(ev) => setSiteId(ev.target.value)} required>
            <option value="">Select site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </FormSelect>
          {e.site_id ? <p className="text-xs text-danger">{e.site_id}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="technician_id">Technician</Label>
          <FormSelect key={siteId} id="technician_id" name="technician_id" defaultValue={v.technician_id ?? siteTechs[0]?.id ?? ''}>
            <option value="">— Unassigned —</option>
            {siteTechs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </FormSelect>
          {siteId && siteTechs.length === 0 ? (
            <p className="text-xs text-warning">No technician is assigned to this site.</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="template_id">PM template</Label>
          <FormSelect id="template_id" name="template_id" defaultValue={v.template_id ?? templates[0]?.id ?? ''} required>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <FormSelect id="priority" name="priority" defaultValue={v.priority ?? 'MEDIUM'}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </FormSelect>
        </div>
      </div>
      <fieldset className="grid gap-4 rounded-lg border p-4 md:grid-cols-4">
        <legend className="px-1 text-sm font-medium">Recurrence</legend>
        <div className="space-y-1.5">
          <Label htmlFor="frequency">Frequency</Label>
          <FormSelect id="frequency" name="frequency" defaultValue={v.frequency ?? 'MONTHLY'}>
            {FREQUENCIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </FormSelect>
          {e.frequency ? <p className="text-xs text-danger">{e.frequency}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="start_date">First scheduled date</Label>
          <Input id="start_date" name="start_date" type="date" defaultValue={v.start_date ?? today} required />
          {e.start_date ? <p className="text-xs text-danger">{e.start_date}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="occurrences">Occurrences</Label>
          <Input id="occurrences" name="occurrences" type="number" min={1} max={MAX_OCCURRENCES} defaultValue={v.occurrences ?? '1'} />
          {e.occurrences ? <p className="text-xs text-danger">{e.occurrences}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="due_days">Due within (days)</Label>
          <Input id="due_days" name="due_days" type="number" min={0} max={90} defaultValue={v.due_days ?? '7'} />
          {e.due_days ? <p className="text-xs text-danger">{e.due_days}</p> : null}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes for the technician</Label>
        <Textarea id="notes" name="notes" defaultValue={v.notes} />
      </div>
      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Create schedule
      </Button>
    </form>
  );
}

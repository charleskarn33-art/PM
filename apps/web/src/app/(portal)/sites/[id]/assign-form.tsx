'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { assignTechnician, type AssignmentState } from '../actions';

export function AssignForm({
  siteId,
  technicians,
  today,
}: {
  siteId: string;
  technicians: { id: string; label: string }[];
  today: string;
}) {
  const [state, action, pending] = useActionState<AssignmentState, FormData>(assignTechnician, {});
  return (
    <form action={action} className="space-y-3 border-t pt-4">
      <input type="hidden" name="site_id" value={siteId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="technician_id">Assign technician</Label>
          <Select id="technician_id" name="technician_id" required defaultValue="">
            <option value="" disabled>
              Select technician…
            </option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="starts_on">From</Label>
          <Input id="starts_on" name="starts_on" type="date" defaultValue={today} />
        </div>
        <Button type="submit" disabled={pending || technicians.length === 0}>
          Assign
        </Button>
      </div>
      {technicians.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active technicians are available in your scope.</p>
      ) : null}
    </form>
  );
}

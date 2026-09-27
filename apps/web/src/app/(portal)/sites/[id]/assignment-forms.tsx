'use client';

import { useActionState } from 'react';
import { FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { FormState } from '@/lib/form-action';
import { assignToSite, endAssignment } from '../actions';

export function AssignForm({ siteId, role, people, today }: { siteId: string; role: 'TECHNICIAN' | 'SUPERVISOR'; people: { id: string; fullName: string }[]; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(assignToSite, {});
  const label = role === 'SUPERVISOR' ? 'Appoint supervisor' : 'Assign technician';
  return (
    <form action={action} className="space-y-3 border-t pt-4">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="role" value={role} />
      <FormMessages state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`user-${role}`}>{label}</Label>
          <Select id={`user-${role}`} name="userId" required defaultValue="">
            <option value="" disabled>
              Select…
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`start-${role}`}>From</Label>
          <Input id={`start-${role}`} name="startDate" type="date" required defaultValue={today} />
        </div>
        <Button type="submit" disabled={pending || people.length === 0}>
          {role === 'SUPERVISOR' ? 'Appoint' : 'Assign'}
        </Button>
      </div>
      {people.length === 0 ? <p className="text-xs text-muted-foreground">Nobody with this role is available in your scope.</p> : null}
    </form>
  );
}

export function EndAssignmentForm({ siteId, assignmentId, today }: { siteId: string; assignmentId: string; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(endAssignment, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="endDate" value={today} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        End today
      </Button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

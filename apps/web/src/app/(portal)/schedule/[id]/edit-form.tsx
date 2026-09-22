'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { updateSchedule, type ScheduleFormState } from '../actions';

interface Props {
  schedule: { id: string; scheduled_date: string; due_date: string; technician_id: string | null; priority: string; notes: string | null };
  technicians: { id: string; name: string }[];
}

export function EditScheduleForm({ schedule, technicians }: Props) {
  const [state, action, pending] = useActionState<ScheduleFormState, FormData>(updateSchedule, {});
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={schedule.id} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="technician_id">Technician</Label>
          <FormSelect id="technician_id" name="technician_id" defaultValue={v.technician_id ?? schedule.technician_id ?? ''}>
            <option value="">— Unassigned —</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <FormSelect id="priority" name="priority" defaultValue={v.priority ?? schedule.priority}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheduled_date">Scheduled date</Label>
          <Input id="scheduled_date" name="scheduled_date" type="date" defaultValue={v.scheduled_date ?? schedule.scheduled_date} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="due_date">Due date</Label>
          <Input id="due_date" name="due_date" type="date" defaultValue={v.due_date ?? schedule.due_date} />
          {state.fieldErrors?.due_date ? <p className="text-xs text-danger">{state.fieldErrors.due_date}</p> : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={v.notes ?? schedule.notes ?? ''} />
      </div>
      <Button type="submit" disabled={pending}>
        Save changes
      </Button>
    </form>
  );
}

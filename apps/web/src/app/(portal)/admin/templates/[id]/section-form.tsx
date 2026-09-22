'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveSection, type TemplateFormState } from '../actions';

export function SectionForm({
  templateId,
  section,
}: {
  templateId: string;
  section: { id: string; name: string; description: string | null; allow_not_applicable: boolean; is_active: boolean };
}) {
  const [state, action, pending] = useActionState<TemplateFormState, FormData>(saveSection, {});
  const v = state.values;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
      <input type="hidden" name="id" value={section.id} />
      <input type="hidden" name="template_id" value={templateId} />
      {state.error ? <Alert tone="danger" className="sm:col-span-4">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success" className="sm:col-span-4">{state.success}</Alert> : null}
      <div className="space-y-1.5">
        <Label htmlFor={`name-${section.id}`}>Section name</Label>
        <Input id={`name-${section.id}`} name="name" defaultValue={v?.name ?? section.name} />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="allow_not_applicable" defaultChecked={v ? v.allow_not_applicable === 'on' : section.allow_not_applicable} className="size-4" />
        Can be N/A
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="is_active" defaultChecked={v ? v.is_active === 'on' : section.is_active} className="size-4" />
        Active
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save section
      </Button>
    </form>
  );
}

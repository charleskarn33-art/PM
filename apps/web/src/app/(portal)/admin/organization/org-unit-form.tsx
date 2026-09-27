'use client';

import { useActionState } from 'react';
import { FieldError, FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import type { FormState } from '@/lib/form-action';
import { saveOrgUnit } from './actions';

export function OrgUnitForm({
  kind,
  initial,
  parents,
  parentLabel,
}: {
  kind: 'region' | 'cluster' | 'county';
  initial?: { id: string; code: string; name: string; isActive: boolean };
  parents?: { id: string; name: string }[];
  parentLabel?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveOrgUnit, {});
  const e = state.fieldErrors ?? {};
  const key = initial?.id ?? `new-${kind}`;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="kind" value={kind} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessages state={state} />
      {!initial && parents ? (
        <div className="space-y-1">
          <Label htmlFor={`${key}-parent`}>{parentLabel}</Label>
          <FormSelect id={`${key}-parent`} name="parentId" required defaultValue={state.values?.parentId ?? ''}>
            <option value="">Select…</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </FormSelect>
        </div>
      ) : null}
      <div className="grid grid-cols-[8rem_1fr] gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${key}-code`}>Code</Label>
          <Input id={`${key}-code`} name="code" required maxLength={32} defaultValue={state.values?.code ?? initial?.code ?? ''} />
          <FieldError message={e.code} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${key}-name`}>Name</Label>
          <Input id={`${key}-name`} name="name" required maxLength={120} defaultValue={state.values?.name ?? initial?.name ?? ''} />
          <FieldError message={e.name} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="size-4" />
        Active
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {initial ? 'Save' : 'Add'}
      </Button>
    </form>
  );
}

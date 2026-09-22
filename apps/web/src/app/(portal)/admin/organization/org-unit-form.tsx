'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { saveOrgUnit, type OrgFormState, type OrgKind } from './actions';

interface Props {
  kind: OrgKind;
  initial?: { id: string; code: string; name: string; parent_id: string | null; is_active: boolean };
  parents?: { id: string; name: string }[];
  parentLabel?: string;
}

export function OrgUnitForm({ kind, initial, parents, parentLabel }: Props) {
  const [state, action, pending] = useActionState<OrgFormState, FormData>(saveOrgUnit, {});
  const e = state.fieldErrors ?? {};
  const values = state.values;
  const prefix = `${kind}-${initial?.id ?? 'new'}`;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="kind" value={kind} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-code`}>Code</Label>
          <Input id={`${prefix}-code`} name="code" defaultValue={values?.code ?? initial?.code} required aria-invalid={Boolean(e.code) || undefined} />
          {e.code ? <p className="text-xs text-danger">{e.code}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-name`}>Name</Label>
          <Input id={`${prefix}-name`} name="name" defaultValue={values?.name ?? initial?.name} required aria-invalid={Boolean(e.name) || undefined} />
          {e.name ? <p className="text-xs text-danger">{e.name}</p> : null}
        </div>
        {parents ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-parent`}>{parentLabel}</Label>
            <FormSelect id={`${prefix}-parent`} name="parent_id" defaultValue={values?.parent_id ?? initial?.parent_id ?? ''} required>
              <option value="" disabled>
                Select…
              </option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </FormSelect>
            {e.parent_id ? <p className="text-xs text-danger">{e.parent_id}</p> : null}
          </div>
        ) : null}
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="hidden" name="is_active" value="false" />
          <input type="checkbox" name="is_active" value="true" defaultChecked={initial?.is_active ?? true} className="size-4" />
          Active
        </label>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {initial ? 'Save' : 'Add'}
      </Button>
    </form>
  );
}

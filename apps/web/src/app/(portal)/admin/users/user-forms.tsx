'use client';

import { useActionState } from 'react';
import { FieldError, FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import type { FormState } from '@/lib/form-action';
import { accountStep, createUser, setRegions, setRoles, updateUser } from './actions';

export interface Option {
  id: string;
  label: string;
  description?: string;
}

function Checks({ name, options, selected }: { name: string; options: Option[]; selected: string[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
          <input type="checkbox" name={name} value={o.id} defaultChecked={selected.includes(o.id)} className="mt-0.5 size-4" />
          <span>
            <span className="font-medium">{o.label}</span>
            {o.description ? <span className="block text-xs text-muted-foreground">{o.description}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

export function NewUserForm({ roles, regions }: { roles: Option[]; regions: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createUser, {});
  const e = state.fieldErrors ?? {};
  const v = (k: string) => state.values?.[k] ?? '';
  return (
    <form action={action} className="space-y-5">
      <FormMessages state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" required maxLength={254} defaultValue={v('email')} autoComplete="off" />
          <FieldError message={e.email} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" required maxLength={120} defaultValue={v('fullName')} />
          <FieldError message={e.fullName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" maxLength={32} defaultValue={v('phone')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="employeeCode">Employee code</Label>
          <Input id="employeeCode" name="employeeCode" maxLength={32} defaultValue={v('employeeCode')} />
          <FieldError message={e.employeeCode} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="homeRegionId">Home region</Label>
          <FormSelect id="homeRegionId" name="homeRegionId" defaultValue={v('homeRegionId')}>
            <option value="">None</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="temporaryPassword">Temporary password</Label>
          <Input id="temporaryPassword" name="temporaryPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} />
          <p className="text-xs text-muted-foreground">Give it to the person yourself; they must change it at their first sign-in. Leave empty to set it later.</p>
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Roles</legend>
        <Checks name="roles" options={roles} selected={[]} />
        <FieldError message={e.roles} />
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Regions in scope</legend>
        <p className="text-xs text-muted-foreground">Managers, supervisors and viewers see only these regions. Technicians see the sites they are assigned to.</p>
        <Checks name="regionScopeIds" options={regions} selected={[]} />
        <FieldError message={e.regionScopeIds} />
      </fieldset>
      <Button type="submit" disabled={pending}>
        Create user
      </Button>
    </form>
  );
}

export function DetailsForm({ user, regions }: { user: { id: string; fullName: string; phone: string | null; employeeCode: string | null; homeRegionId: string | null }; regions: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateUser, {});
  const e = state.fieldErrors ?? {};
  const v = (k: string, d: string | null) => state.values?.[k] ?? d ?? '';
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={user.id} />
      <FormMessages state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="d-fullName">Full name</Label>
          <Input id="d-fullName" name="fullName" required maxLength={120} defaultValue={v('fullName', user.fullName)} />
          <FieldError message={e.fullName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-phone">Phone</Label>
          <Input id="d-phone" name="phone" maxLength={32} defaultValue={v('phone', user.phone)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-employeeCode">Employee code</Label>
          <Input id="d-employeeCode" name="employeeCode" maxLength={32} defaultValue={v('employeeCode', user.employeeCode)} />
          <FieldError message={e.employeeCode} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-homeRegionId">Home region</Label>
          <FormSelect id="d-homeRegionId" name="homeRegionId" defaultValue={v('homeRegionId', user.homeRegionId)}>
            <option value="">None</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </FormSelect>
        </div>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Save details
      </Button>
    </form>
  );
}

export function RolesForm({ id, roles, selected }: { id: string; roles: Option[]; selected: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setRoles, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <FormMessages state={state} />
      <Checks name="roles" options={roles} selected={selected} />
      <Button type="submit" variant="outline" disabled={pending}>
        Save roles
      </Button>
    </form>
  );
}

export function RegionsForm({ id, regions, selected }: { id: string; regions: Option[]; selected: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setRegions, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <FormMessages state={state} />
      <Checks name="regionIds" options={regions} selected={selected} />
      <Button type="submit" variant="outline" disabled={pending}>
        Save regions
      </Button>
    </form>
  );
}

export function AccountButton({ id, step, label, variant = 'outline' }: { id: string; step: 'activate' | 'deactivate' | 'unlock'; label: string; variant?: 'outline' | 'destructive' }) {
  const [state, action, pending] = useActionState<FormState, FormData>(accountStep, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="step" value={step} />
      <FormMessages state={state} />
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>
    </form>
  );
}

export function TemporaryPasswordForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(accountStep, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="step" value="temporary-password" />
      <FormMessages state={state} />
      <Label htmlFor="tp">New temporary password</Label>
      <Input id="tp" name="temporaryPassword" type="password" required autoComplete="new-password" minLength={12} maxLength={128} />
      <FieldError message={state.fieldErrors?.temporaryPassword} />
      <Button type="submit" variant="outline" disabled={pending}>
        Set temporary password
      </Button>
    </form>
  );
}

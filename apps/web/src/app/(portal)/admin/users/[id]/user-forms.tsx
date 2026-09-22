'use client';

import { ROLE_LABELS, type AppRole } from '@ipt/shared';
import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { updateRoleDetails, updateUserAccess, type UserFormState } from '../actions';

type Option = { id: string; name: string };

export function AccessForm({
  userId,
  role,
  isActive,
  regionId,
  scopeRegionIds,
  regions,
  isSelf,
}: {
  userId: string;
  role: AppRole;
  isActive: boolean;
  regionId: string | null;
  scopeRegionIds: string[];
  regions: Option[];
  isSelf: boolean;
}) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(updateUserAccess, {});
  const [selectedRole, setSelectedRole] = useState<AppRole>(role);
  const scoped = selectedRole === 'regional_manager' || selectedRole === 'regional_supervisor';

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="user_id" value={userId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      {isSelf ? <Alert tone="info">You cannot remove your own Super Admin access.</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          {/* Uncontrolled: React's post-action form reset must restore the saved role,
              never fall back to the first option. */}
          <FormSelect id="role" name="role" defaultValue={role} onChange={(e) => setSelectedRole(e.target.value as AppRole)}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="is_active">Account</Label>
          <FormSelect id="is_active" name="is_active" defaultValue={String(isActive)}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="region_id">Home region</Label>
          <FormSelect id="region_id" name="region_id" defaultValue={regionId ?? ''}>
            <option value="">— None —</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </FormSelect>
        </div>
      </div>
      {scoped ? (
        <fieldset className="rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Region scope (data access)</legend>
          <div className="flex flex-wrap gap-4">
            {regions.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="scope_region_ids" value={r.id} defaultChecked={scopeRegionIds.includes(r.id)} className="size-4" />
                {r.name}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {ROLE_LABELS[selectedRole]}s see sites, people, PM and issues only in these regions.
          </p>
        </fieldset>
      ) : null}
      <Button type="submit" disabled={pending}>
        Save access
      </Button>
    </form>
  );
}

export function TechnicianDetailsForm({
  userId,
  employeeCode,
  supervisorId,
  regionId,
  supervisors,
  regions,
}: {
  userId: string;
  employeeCode: string | null;
  supervisorId: string | null;
  regionId: string | null;
  supervisors: Option[];
  regions: Option[];
}) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(updateRoleDetails, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="kind" value="technician" />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="employee_code">Employee code</Label>
          <Input id="employee_code" name="employee_code" defaultValue={employeeCode ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="supervisor_id">Supervisor</Label>
          <FormSelect id="supervisor_id" name="supervisor_id" defaultValue={supervisorId ?? ''}>
            <option value="">— None —</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="technician_region_id">Technician region</Label>
          <FormSelect id="technician_region_id" name="technician_region_id" defaultValue={regionId ?? ''}>
            <option value="">— None —</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </FormSelect>
        </div>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Save technician details
      </Button>
    </form>
  );
}

export function SupervisorDetailsForm({ userId, employeeCode }: { userId: string; employeeCode: string | null }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(updateRoleDetails, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="kind" value="supervisor" />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="sup_employee_code">Employee code</Label>
        <Input id="sup_employee_code" name="employee_code" defaultValue={employeeCode ?? ''} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Save supervisor details
      </Button>
    </form>
  );
}

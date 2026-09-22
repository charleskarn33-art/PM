'use client';

import { ROLE_LABELS } from '@ipt/shared';
import { Loader2 } from 'lucide-react';
import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { inviteUser, type InviteState } from '../actions';

export function InviteForm({ regions, disabled }: { regions: { id: string; name: string }[]; disabled: boolean }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteUser, {});
  const e = state.fieldErrors ?? {};
  const values = state.values ?? {};
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" defaultValue={values.full_name} required aria-invalid={Boolean(e.full_name) || undefined} />
          {e.full_name ? <p className="text-xs text-danger">{e.full_name}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input id="email" name="email" type="email" defaultValue={values.email} required aria-invalid={Boolean(e.email) || undefined} />
          {e.email ? <p className="text-xs text-danger">{e.email}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <FormSelect id="role" name="role" required defaultValue={values.role ?? ''}>
            <option value="" disabled>
              Select role…
            </option>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </FormSelect>
          {e.role ? <p className="text-xs text-danger">{e.role}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="region_id">Home region</Label>
          <FormSelect id="region_id" name="region_id" defaultValue={values.region_id ?? ''}>
            <option value="">— None —</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </FormSelect>
        </div>
      </div>
      <Button type="submit" variant="accent" disabled={pending || disabled}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Send invitation
      </Button>
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import { FieldError, FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormState } from '@/lib/form-action';
import { saveGeofence, savePmRules } from './actions';

const MODES = [
  ['WARN', 'Warn', 'The PM starts anywhere; the position and distance are recorded and shown to the supervisor.'],
  ['REQUIRE_REASON', 'Require a reason', 'Outside the radius (or without a location) the technician must say why before starting.'],
  ['BLOCK', 'Block', 'The PM can only be started within the radius, with a location.'],
] as const;

export function GeofenceForm({ mode, radiusM }: { mode: string; radiusM: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveGeofence, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessages state={state} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">When a technician starts a PM away from the site</legend>
        {MODES.map(([value, label, help]) => (
          <label key={value} className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input type="radio" name="mode" value={value} defaultChecked={(state.values?.mode ?? mode) === value} className="mt-0.5" />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-muted-foreground">{help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="radiusM">Default radius (metres)</Label>
        <Input id="radiusM" name="radiusM" type="number" min={1} max={100000} required defaultValue={state.values?.radiusM ?? radiusM} />
        <p className="text-xs text-muted-foreground">A site&apos;s own radius, when set, replaces this.</p>
        <FieldError message={state.fieldErrors?.radiusM} />
      </div>
      <Button type="submit" disabled={pending}>
        Save geofence
      </Button>
    </form>
  );
}

export function PmRulesForm({ requireSignature }: { requireSignature: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePmRules, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessages state={state} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="requireSignature" defaultChecked={requireSignature} className="mt-0.5 size-4" />
        <span>
          <span className="font-medium">Technician signature required to complete a PM</span>
          <span className="block text-muted-foreground">Any change after signing removes the signature.</span>
        </span>
      </label>
      <Button type="submit" disabled={pending}>
        Save PM rules
      </Button>
    </form>
  );
}

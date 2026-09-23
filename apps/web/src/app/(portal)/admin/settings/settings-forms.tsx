'use client';

import { CONSISTENCY_OPERATORS, GEOFENCE_MODES, humanizeStatus } from '@ipt/shared';
import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { saveConsistencyRule, saveDcThresholds, saveGeofence, savePmSubmission, type SettingsFormState } from './actions';

function Messages({ state }: { state: SettingsFormState }) {
  return (
    <>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-danger">{message}</p> : null;
}

const MODE_HELP: Record<string, string> = {
  WARN: 'Record the distance; never stop the technician.',
  REQUIRE_REASON: 'Outside the radius, the technician must give a reason to start.',
  BLOCK: 'Outside the radius (or without GPS), PM cannot be started.',
};

export function GeofenceForm({ initial }: { initial: { radius_m: number; mode: string } }) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(saveGeofence, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <Messages state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="geo-radius">Default radius (metres)</Label>
          <Input id="geo-radius" name="radius_m" type="number" min={1} step={1} required defaultValue={v?.radius_m ?? initial.radius_m} aria-invalid={Boolean(e.radius_m) || undefined} />
          <FieldError message={e.radius_m} />
          <p className="text-xs text-muted-foreground">A site&apos;s own radius, when set on the site, takes precedence.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="geo-mode">When outside the radius</Label>
          <FormSelect id="geo-mode" name="mode" defaultValue={v?.mode ?? initial.mode} required>
            {GEOFENCE_MODES.map((m) => (
              <option key={m} value={m}>
                {humanizeStatus(m)} — {MODE_HELP[m]}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.mode} />
          <p className="text-xs text-muted-foreground">Sites without coordinates are never blocked.</p>
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Save geofence
      </Button>
    </form>
  );
}

export function DcThresholdsForm({ initial }: { initial: { high_load_kw: number | null; high_load_current_a: number | null } }) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(saveDcThresholds, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <Messages state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dc-kw">High load above (kW)</Label>
          <Input id="dc-kw" name="high_load_kw" type="number" min={0} step="any" placeholder="Not configured" defaultValue={v?.high_load_kw ?? initial.high_load_kw ?? ''} aria-invalid={Boolean(e.high_load_kw) || undefined} />
          <FieldError message={e.high_load_kw} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc-a">High load current above (A)</Label>
          <Input id="dc-a" name="high_load_current_a" type="number" min={0} step="any" placeholder="Not configured" defaultValue={v?.high_load_current_a ?? initial.high_load_current_a ?? ''} aria-invalid={Boolean(e.high_load_current_a) || undefined} />
          <FieldError message={e.high_load_current_a} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Leave empty to raise no flag. The system never assumes a limit of its own.</p>
      <Button type="submit" size="sm" disabled={pending}>
        Save thresholds
      </Button>
    </form>
  );
}

export function PmSubmissionForm({ initial }: { initial: { enforce_photo_requirements: boolean } }) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(savePmSubmission, {});
  return (
    <form action={action} className="space-y-3">
      <Messages state={state} />
      <label className="flex items-start gap-2 text-sm">
        <input type="hidden" name="enforce_photo_requirements" value="false" />
        <input
          key={String(initial.enforce_photo_requirements)}
          type="checkbox"
          name="enforce_photo_requirements"
          value="true"
          defaultChecked={initial.enforce_photo_requirements}
          className="mt-0.5 size-4"
        />
        <span>
          Block submission until every required evidence photo is attached
          <span className="block text-xs text-muted-foreground">Which photos are required is set per checklist item in PM Templates.</span>
        </span>
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export interface ValueKey {
  analytics_key: string;
  label: string;
  unit: string | null;
}

export function ConsistencyRuleForm({
  keys,
  initial,
}: {
  keys: ValueKey[];
  initial?: { id: string; lhs_key: string; operator: string; rhs_key: string; message: string; is_active: boolean };
}) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(saveConsistencyRule, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const prefix = `rule-${initial?.id ?? 'new'}`;
  const options = keys.map((k) => (
    <option key={k.analytics_key} value={k.analytics_key}>
      {k.label}
      {k.unit ? ` (${k.unit})` : ''} — {k.analytics_key}
    </option>
  ));
  return (
    <form action={action} className="space-y-3">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Messages state={state} />
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-lhs`}>Value</Label>
          <FormSelect id={`${prefix}-lhs`} name="lhs_key" defaultValue={v?.lhs_key ?? initial?.lhs_key ?? ''} required>
            <option value="" disabled>
              Select…
            </option>
            {options}
          </FormSelect>
          <FieldError message={e.lhs_key} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-op`}>must be</Label>
          <FormSelect id={`${prefix}-op`} name="operator" defaultValue={v?.operator ?? initial?.operator ?? '<='} required>
            {CONSISTENCY_OPERATORS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.operator} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-rhs`}>Compared with</Label>
          <FormSelect id={`${prefix}-rhs`} name="rhs_key" defaultValue={v?.rhs_key ?? initial?.rhs_key ?? ''} required>
            <option value="" disabled>
              Select…
            </option>
            {options}
          </FormSelect>
          <FieldError message={e.rhs_key} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-msg`}>Message shown to the technician when it is not met</Label>
        <Input id={`${prefix}-msg`} name="message" maxLength={300} required defaultValue={v?.message ?? initial?.message} aria-invalid={Boolean(e.message) || undefined} />
        <FieldError message={e.message} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="hidden" name="is_active" value="false" />
        <input type="checkbox" name="is_active" value="true" defaultChecked={initial?.is_active ?? true} className="size-4" />
        Active (checked on the phone and at submission)
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {initial ? 'Save rule' : 'Add rule'}
      </Button>
    </form>
  );
}

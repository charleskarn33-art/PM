'use client';

import { useActionState } from 'react';
import { FieldError, FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormState } from '@/lib/form-action';
import { saveGeofence, saveNotificationSettings, savePmRules, saveThresholds } from './actions';

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

const THRESHOLDS = [
  ['completionTargetPct', 'PM completion target', '%', 'Groups below it are marked in Analytics.', 100],
  ['dcLoadKwMax', 'Maximum DC load', 'kW', 'Sites whose DC load is above it are flagged.', 100000],
  ['rectifierVoltageMin', 'Minimum rectifier voltage', 'V', 'Rectifier voltage below it is flagged.', 10000],
  ['batteryVoltageMin', 'Minimum battery bank voltage', 'V', 'Bank voltage below it is flagged.', 10000],
  ['batteryUnitVoltageMin', 'Minimum single battery voltage', 'V', 'Any battery below it is flagged.', 10000],
  ['fuelLevelMinPct', 'Minimum generator fuel level', '%', 'Fuel below it is flagged.', 100],
  ['generatorServiceHours', 'Generator service hours', 'h', 'Running hours at or above it are flagged as service due.', 10000000],
] as const;

export function ThresholdsForm({ values }: { values: Record<string, number | null> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveThresholds, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessages state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        {THRESHOLDS.map(([key, label, unit, help, max]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={key}>
              {label} ({unit})
            </Label>
            <Input id={key} name={key} type="number" inputMode="decimal" step="any" min={0} max={max} placeholder="Not set" defaultValue={state.values?.[key] ?? values[key] ?? ''} />
            <p className="text-xs text-muted-foreground">{help}</p>
            <FieldError message={state.fieldErrors?.[key]} />
          </div>
        ))}
      </div>
      <Button type="submit" disabled={pending}>
        Save thresholds
      </Button>
    </form>
  );
}

export function NotificationSettingsForm({ pmDueReminderDays, actionOverdueAlerts }: { pmDueReminderDays: number | null; actionOverdueAlerts: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveNotificationSettings, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessages state={state} />
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="pmDueReminderDays">Remind technicians before a PM is due (days)</Label>
        <Input
          id="pmDueReminderDays"
          name="pmDueReminderDays"
          type="number"
          min={1}
          max={60}
          step={1}
          placeholder="No reminder"
          defaultValue={state.values?.pmDueReminderDays ?? pmDueReminderDays ?? ''}
        />
        <p className="text-xs text-muted-foreground">Empty: no reminder. One reminder per PM, sent when it comes within this many days of its due date.</p>
        <FieldError message={state.fieldErrors?.pmDueReminderDays} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="actionOverdueAlerts" defaultChecked={actionOverdueAlerts} className="mt-0.5 size-4" />
        <span>
          <span className="font-medium">Alert when a corrective action is overdue</span>
          <span className="block text-muted-foreground">The assignee and the site&apos;s supervisors are told once when an assigned action passes its due date.</span>
        </span>
      </label>
      <Button type="submit" disabled={pending}>
        Save notification settings
      </Button>
    </form>
  );
}

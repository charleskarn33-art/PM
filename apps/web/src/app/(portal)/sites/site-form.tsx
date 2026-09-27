'use client';

import { useActionState, useState } from 'react';
import { FieldError, FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { FormState } from '@/lib/form-action';
import type { Region, Site } from '@/lib/api/types';
import { saveSite } from './actions';

export function SiteForm({ site, hierarchy }: { site?: Site; hierarchy: Region[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSite, {});
  const e = state.fieldErrors ?? {};
  const v = (key: string, initial: unknown) => (state.values ? (state.values[key] ?? '') : initial == null ? '' : String(initial));
  const checked = (key: string, initial: boolean) => (state.values ? state.values[key] === 'on' : initial);
  // Region / cluster choices only narrow the options below; the selects stay uncontrolled.
  const [regionId, setRegionId] = useState(site?.regionId ?? '');
  const [clusterId, setClusterId] = useState(site?.clusterId ?? '');
  const clusters = hierarchy.find((r) => r.id === regionId)?.clusters ?? [];
  const counties = clusters.find((c) => c.id === clusterId)?.counties ?? [];

  return (
    <form action={action} className="space-y-6">
      {site ? <input type="hidden" name="id" value={site.id} /> : null}
      <FormMessages state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="siteCode">Site ID</Label>
          <Input id="siteCode" name="siteCode" required maxLength={32} defaultValue={v('siteCode', site?.siteCode)} aria-invalid={Boolean(e.siteCode) || undefined} />
          <FieldError message={e.siteCode} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="siteName">Site name</Label>
          <Input id="siteName" name="siteName" required maxLength={120} defaultValue={v('siteName', site?.siteName)} aria-invalid={Boolean(e.siteName) || undefined} />
          <FieldError message={e.siteName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="regionId">Region</Label>
          <FormSelect id="regionId" name="regionId" required defaultValue={v('regionId', site?.regionId)} onChange={(ev) => setRegionId(ev.target.value)}>
            <option value="">Select region…</option>
            {hierarchy.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.isActive}>
                {r.name}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.regionId} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clusterId">Cluster</Label>
          <FormSelect id="clusterId" name="clusterId" defaultValue={v('clusterId', site?.clusterId)} onChange={(ev) => setClusterId(ev.target.value)}>
            <option value="">None</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.isActive}>
                {c.name}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.clusterId} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="countyId">County</Label>
          <FormSelect id="countyId" name="countyId" defaultValue={v('countyId', site?.countyId)}>
            <option value="">None</option>
            {counties.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.isActive}>
                {c.name}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.countyId} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <FormSelect id="status" name="status" defaultValue={v('status', site?.status ?? 'ACTIVE')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="DECOMMISSIONED">Decommissioned</option>
          </FormSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="latitude">Latitude</Label>
          <Input id="latitude" name="latitude" type="number" step="any" min={-90} max={90} defaultValue={v('latitude', site?.latitude)} aria-invalid={Boolean(e.latitude) || undefined} />
          <FieldError message={e.latitude} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="longitude">Longitude</Label>
          <Input id="longitude" name="longitude" type="number" step="any" min={-180} max={180} defaultValue={v('longitude', site?.longitude)} aria-invalid={Boolean(e.longitude) || undefined} />
          <FieldError message={e.longitude} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="address">Address</Label>
          <Textarea id="address" name="address" maxLength={500} defaultValue={v('address', site?.address)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="siteType">Site type</Label>
          <Input id="siteType" name="siteType" maxLength={50} defaultValue={v('siteType', site?.siteType)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="geofenceRadiusM">PM start radius (m)</Label>
          <Input id="geofenceRadiusM" name="geofenceRadiusM" type="number" min={1} max={100000} placeholder="System setting" defaultValue={v('geofenceRadiusM', site?.geofenceRadiusM)} />
          <FieldError message={e.geofenceRadiusM} />
        </div>
      </div>
      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Power equipment</legend>
        <div className="flex flex-wrap gap-6 text-sm">
          {(
            [
              ['generatorAvailable', 'Generator', site?.generatorAvailable ?? false],
              ['solarAvailable', 'Solar', site?.solarAvailable ?? false],
              ['gridAvailable', 'Grid', site?.gridAvailable ?? false],
            ] as const
          ).map(([key, label, initial]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" name={key} defaultChecked={checked(key, initial)} className="size-4" />
              {label}
            </label>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="batteryUnitCount">Batteries in the bank</Label>
            <Input id="batteryUnitCount" name="batteryUnitCount" type="number" min={1} max={1000} placeholder="Not recorded one by one" defaultValue={v('batteryUnitCount', site?.batteryUnitCount)} />
            <p className="text-xs text-muted-foreground">When set, each PM records every battery&apos;s voltage.</p>
            <FieldError message={e.batteryUnitCount} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="batteryConfiguration">Battery configuration</Label>
            <Input id="batteryConfiguration" name="batteryConfiguration" maxLength={500} defaultValue={v('batteryConfiguration', site?.batteryConfiguration)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="powerConfiguration">Power configuration</Label>
            <Input id="powerConfiguration" name="powerConfiguration" maxLength={500} defaultValue={v('powerConfiguration', site?.powerConfiguration)} />
          </div>
        </div>
      </fieldset>
      <Button type="submit" disabled={pending}>
        {site ? 'Save changes' : 'Create site'}
      </Button>
    </form>
  );
}

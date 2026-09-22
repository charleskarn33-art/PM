'use client';

import type { SiteField } from '@ipt/shared';
import { Loader2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ClusterOption, CountyOption, RegionOption, SupervisorOption } from '@/lib/org-data';
import { saveSite, type SiteFormState } from './actions';

export interface SiteFormValues {
  id?: string;
  site_code: string;
  site_name: string;
  region_id: string;
  cluster_id: string | null;
  county_id: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  site_type: string | null;
  power_configuration: string | null;
  generator_available: boolean;
  solar_available: boolean;
  battery_available: boolean;
  grid_available: boolean;
  status: string;
  supervisor_id: string | null;
  geofence_radius_m: number | null;
}

interface Props {
  initial?: SiteFormValues;
  regions: RegionOption[];
  clusters: ClusterOption[];
  counties: CountyOption[];
  supervisors: SupervisorOption[];
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-danger">{message}</p> : null;
}

export function SiteForm({ initial, regions, clusters, counties, supervisors }: Props) {
  const [state, action, pending] = useActionState<SiteFormState, FormData>(saveSite, {});
  // Selected region/cluster only drive which child options are listed; the
  // selects themselves stay uncontrolled so React's post-action form reset
  // restores them to the submitted values.
  const [regionId, setRegionId] = useState(initial?.region_id ?? '');
  const [clusterId, setClusterId] = useState(initial?.cluster_id ?? '');
  const e = state.fieldErrors ?? {};
  // Submitted values win over the initial record after a failed submit.
  const v = (name: keyof SiteFormValues): string =>
    state.values ? (state.values[name] ?? '') : initial?.[name] == null ? '' : String(initial[name]);
  const checked = (name: keyof SiteFormValues): boolean =>
    state.values ? state.values[name] === 'on' : Boolean(initial?.[name]);
  const err = (f: SiteField) => ({ 'aria-invalid': Boolean(e[f]) || undefined });

  const regionClusters = clusters.filter((c) => c.region_id === regionId);
  const clusterCounties = counties.filter((c) => c.cluster_id === clusterId);

  return (
    <form action={action} className="space-y-6">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Identification</legend>
        <div className="space-y-2">
          <Label htmlFor="site_code">Site ID</Label>
          <Input id="site_code" name="site_code" defaultValue={v('site_code')} required {...err('site_code')} />
          <FieldError message={e.site_code} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="site_name">Site name</Label>
          <Input id="site_name" name="site_name" defaultValue={v('site_name')} required {...err('site_name')} />
          <FieldError message={e.site_name} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="site_type">Site type</Label>
          <Input id="site_type" name="site_type" defaultValue={v('site_type')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <FormSelect id="status" name="status" defaultValue={v('status') || 'ACTIVE'}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="DECOMMISSIONED">Decommissioned</option>
          </FormSelect>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Organisation</legend>
        <div className="space-y-2">
          <Label htmlFor="region_id">Region</Label>
          <FormSelect
            id="region_id"
            name="region_id"
            defaultValue={v('region_id')}
            onChange={(ev) => {
              setRegionId(ev.target.value);
              setClusterId('');
            }}
            required
            {...err('region_id')}
          >
            <option value="">Select region…</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.is_active}>
                {r.name}
                {r.is_active ? '' : ' (inactive)'}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.region_id} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cluster_id">Cluster</Label>
          <FormSelect
            key={regionId}
            id="cluster_id"
            name="cluster_id"
            defaultValue={regionId === (state.values?.region_id ?? initial?.region_id) ? v('cluster_id') : ''}
            onChange={(ev) => setClusterId(ev.target.value)}
          >
            <option value="">— None —</option>
            {regionClusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="county_id">County</Label>
          <FormSelect key={clusterId} id="county_id" name="county_id" defaultValue={v('county_id')}>
            <option value="">— None —</option>
            {clusterCounties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FormSelect>
          <p className="text-xs text-muted-foreground">Region and cluster are derived from the county when set.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="supervisor_id">Supervisor</Label>
          <FormSelect id="supervisor_id" name="supervisor_id" defaultValue={v('supervisor_id')} {...err('supervisor_id')}>
            <option value="">— None —</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id} disabled={!s.is_active}>
                {s.name}
              </option>
            ))}
          </FormSelect>
          <FieldError message={e.supervisor_id} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Location</legend>
        <div className="space-y-2">
          <Label htmlFor="latitude">Latitude</Label>
          <Input id="latitude" name="latitude" inputMode="decimal" defaultValue={v('latitude')} {...err('latitude')} />
          <FieldError message={e.latitude} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="longitude">Longitude</Label>
          <Input id="longitude" name="longitude" inputMode="decimal" defaultValue={v('longitude')} {...err('longitude')} />
          <FieldError message={e.longitude} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="geofence_radius_m">Geofence radius (m)</Label>
          <Input
            id="geofence_radius_m"
            name="geofence_radius_m"
            inputMode="numeric"
            placeholder="System default"
            defaultValue={v('geofence_radius_m')}
            {...err('geofence_radius_m')}
          />
          <FieldError message={e.geofence_radius_m} />
        </div>
        <div className="space-y-2 md:col-span-3">
          <Label htmlFor="address">Address / directions</Label>
          <Textarea id="address" name="address" defaultValue={v('address')} />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">Power configuration</legend>
        <div className="flex flex-wrap gap-6">
          {(
            [
              ['generator_available', 'Generator'],
              ['battery_available', 'Battery'],
              ['solar_available', 'Solar'],
              ['grid_available', 'Grid'],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={name} defaultChecked={checked(name)} className="size-4" />
              {label}
            </label>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="power_configuration">Configuration notes</Label>
          <Input id="power_configuration" name="power_configuration" defaultValue={v('power_configuration')} />
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {initial?.id ? 'Save changes' : 'Create site'}
      </Button>
    </form>
  );
}

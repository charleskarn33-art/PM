import { dcPowerKw, type Database } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Client = SupabaseClient<Database>;

/** Only PM that the technician has submitted counts as reported data. */
const REPORTED = ['SUBMITTED', 'APPROVED'] as const;

function one<T>(label: string, r: { data: T | null; error: { message: string } | null }): T | null {
  if (r.error) throw new Error(`Unable to load ${label}: ${r.error.message}`);
  return r.data;
}

const d = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-GB') : '');
const n = (v: number | null | undefined, unit: string, digits = 2) => (v == null ? '—' : `${Number(v.toFixed(digits))} ${unit}`);

/** Most recent value per section for a site (from PM visits the viewer may see). */
export async function LatestReadings({ supabase, siteId }: { supabase: Client; siteId: string }) {
  const newest = { ascending: false } as const;
  const [genR, dcR, batR, solR, earthR] = await Promise.all([
    supabase.from('generator_readings').select('*, pm_visits!inner(status)').eq('site_id', siteId).in('pm_visits.status', REPORTED).order('recorded_at', newest).limit(1).maybeSingle(),
    supabase.from('dc_readings').select('*, pm_visits!inner(status)').eq('site_id', siteId).in('pm_visits.status', REPORTED).order('recorded_at', newest).limit(1).maybeSingle(),
    supabase.from('battery_readings').select('*, pm_visits!inner(status)').eq('site_id', siteId).in('pm_visits.status', REPORTED).order('recorded_at', newest).limit(1).maybeSingle(),
    supabase.from('solar_readings').select('*, pm_visits!inner(status)').eq('site_id', siteId).in('pm_visits.status', REPORTED).order('recorded_at', newest).limit(1).maybeSingle(),
    supabase.from('earthing_readings').select('*, pm_visits!inner(status)').eq('site_id', siteId).in('pm_visits.status', REPORTED).order('recorded_at', newest).limit(1).maybeSingle(),
  ]);
  const gen = one('generator readings', genR);
  const dc = one('DC readings', dcR);
  const bat = one('battery readings', batR);
  const sol = one('solar readings', solR);
  const earth = one('earthing readings', earthR);
  const rows: { section: string; value: string; when: string }[] = [
    gen && { section: 'Generator', value: `${n(gen.running_hours, 'h', 1)} · fuel ${n(gen.fuel_level_pct, '%', 1)} · ${n(gen.generator_kva, 'kVA', 1)}`, when: d(gen.recorded_at) },
    dc && {
      section: 'DC System',
      value: `${n(dc.rectifier_voltage_v, 'V')} · ${n(dc.load_current_a, 'A')} · ${n(dc.dc_power_kw ?? dcPowerKw(dc.rectifier_voltage_v, dc.load_current_a), 'kW (calculated)', 3)}`,
      when: d(dc.recorded_at),
    },
    bat && { section: 'Battery', value: `${n(bat.battery_voltage_v, 'V')} · ${n(bat.capacity_ah, 'Ah', 0)} · ${bat.string_count ?? '—'} string(s)`, when: d(bat.recorded_at) },
    sol && { section: 'Solar', value: `${sol.panels_operational ?? '—'} / ${sol.panels_installed ?? '—'} panels operational · controller ${n(sol.charge_controller_output_v, 'V')}`, when: d(sol.recorded_at) },
    earth && {
      section: 'Earthing / Grounding',
      value: earth.abnormalities_found ? 'Abnormalities reported' : earth.abnormalities_found === false ? 'No abnormalities' : '—',
      when: d(earth.recorded_at),
    },
  ].filter(Boolean) as { section: string; value: string; when: string }[];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest readings</CardTitle>
        <CardDescription>From the most recent submitted or approved PM that recorded each section.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PM readings recorded yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.section} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">{r.section}</span>
                <span className="tabular-nums">{r.value}</span>
                <span className="text-xs text-muted-foreground">{r.when}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

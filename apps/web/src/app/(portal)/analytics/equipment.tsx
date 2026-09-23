import { dcHighLoad, type Database, type DcThresholds } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BarList } from '@/components/charts/bar-list';
import { ChartCard } from '@/components/charts/chart-card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { loadLatestReadings } from '@/lib/analytics';
import { phaseImbalancePct, type AnalyticsParams } from '@/lib/analytics-params';

type Client = SupabaseClient<Database>;
const n = (v: number | null, unit = '', digits = 1) => (v == null ? '—' : `${Number(Number(v).toFixed(digits))}${unit ? ` ${unit}` : ''}`);
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—');
const yes = (v: boolean | null, bad = true) => (v == null ? '—' : v === bad ? <Badge tone="danger">Yes</Badge> : 'No');

export async function EquipmentTab({ supabase, p }: { supabase: Client; p: AnalyticsParams }) {
  const [rows, setting] = await Promise.all([
    loadLatestReadings(supabase, p.region),
    supabase.from('system_settings').select('value').eq('key', 'dc_thresholds').maybeSingle(),
  ]);
  const thresholds = (setting.data?.value as unknown as DcThresholds | undefined) ?? null;
  const dc = rows.filter((r) => r.dc_recorded_at);
  const gen = rows.filter((r) => r.gen_recorded_at);
  const bat = rows.filter((r) => r.battery_recorded_at);
  const sol = rows.filter((r) => r.solar_recorded_at);
  const configured = thresholds?.high_load_kw != null || thresholds?.high_load_current_a != null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Latest readings per site from submitted or approved PMs (the period filter does not apply here).</p>
      <ChartCard
        title="DC load by site"
        description={
          configured
            ? `Calculated DC power (V × A ÷ 1000). Flagged when above the configured ${[thresholds?.high_load_kw != null ? `${thresholds.high_load_kw} kW` : null, thresholds?.high_load_current_a != null ? `${thresholds.high_load_current_a} A` : null].filter(Boolean).join(' / ')}.`
            : 'Calculated DC power (V × A ÷ 1000). No high-load thresholds are configured (Admin → Settings).'
        }
        empty={dc.length === 0 && 'No DC readings recorded yet.'}
      >
        <BarList
          items={[...dc]
            .sort((a, b) => Number(b.dc_power_kw ?? 0) - Number(a.dc_power_kw ?? 0))
            .slice(0, 15)
            .map((r) => {
              const high = dcHighLoad(r.dc_power_kw, r.load_current_a, thresholds);
              return {
                label: `${r.site_code} ${r.site_name}`,
                value: r.dc_power_kw == null ? null : Number(r.dc_power_kw),
                display: `${n(r.dc_power_kw, 'kW', 2)}${high.kw || high.current ? ' · high load' : ''}`,
                color: high.kw || high.current ? 'var(--status-critical)' : undefined,
                href: `/sites/${r.site_id}`,
              };
            })}
        />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Site</TableHead>
                <TableHead>Recorded</TableHead>
                <TableHead className="text-right">Voltage</TableHead>
                <TableHead className="text-right">Load current</TableHead>
                <TableHead className="text-right">DC power</TableHead>
                <TableHead className="text-right">Modules</TableHead>
                <TableHead className="text-right">Phases</TableHead>
                <TableHead className="text-right">Phase imbalance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dc.map((r) => {
                const imbalance = phaseImbalancePct(r.phase_min_a, r.phase_max_a, r.phase_total_a, r.phase_count);
                return (
                  <TableRow key={r.site_id}>
                    <TableCell className="whitespace-nowrap">
                      {r.site_code} {r.site_name} {r.is_demo ? <Badge>Demo</Badge> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{date(r.dc_recorded_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{n(r.rectifier_voltage_v, 'V')}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{n(r.load_current_a, 'A')}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{n(r.dc_power_kw, 'kW', 2)}</TableCell>
                    <TableCell className={r.dc_modules_operational != null && r.dc_modules_installed != null && r.dc_modules_operational < r.dc_modules_installed ? 'whitespace-nowrap text-right tabular-nums text-warning' : 'whitespace-nowrap text-right tabular-nums'}>
                      {r.dc_modules_installed == null ? '—' : `${r.dc_modules_operational ?? '—'}/${r.dc_modules_installed}`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{r.phase_count ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{imbalance == null ? '—' : `${imbalance}%`}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">Phase imbalance = (highest − lowest phase current) ÷ average phase current. It is shown for information; no limit is assumed.</p>
      </ChartCard>

      <div className="grid gap-6 2xl:grid-cols-2">
        <ChartCard title="Generators" empty={gen.length === 0 && 'No generator readings recorded yet.'}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Site</TableHead>
                <TableHead className="text-right">Running hours</TableHead>
                <TableHead className="text-right">Fuel</TableHead>
                <TableHead className="text-right">Oil pressure</TableHead>
                <TableHead className="text-right">kVA</TableHead>
                <TableHead>Needs service</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...gen].sort((a, b) => Number(b.generator_requires_service) - Number(a.generator_requires_service)).map((r) => (
                <TableRow key={r.site_id}>
                  <TableCell className="whitespace-nowrap">{r.site_code}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{n(r.running_hours, 'h', 0)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{n(r.fuel_level_pct, '%', 0)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{n(r.oil_pressure_bar, 'bar')}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{n(r.generator_kva, '', 0)}</TableCell>
                  <TableCell>{yes(r.generator_requires_service)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartCard>
        <ChartCard title="Batteries" empty={bat.length === 0 && 'No battery readings recorded yet.'}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Site</TableHead>
                <TableHead className="text-right">Voltage</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
                <TableHead className="text-right">Strings</TableHead>
                <TableHead>Damage</TableHead>
                <TableHead>Water top-up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bat.map((r) => (
                <TableRow key={r.site_id}>
                  <TableCell className="whitespace-nowrap">{r.site_code}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{n(r.battery_voltage_v, 'V')}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{n(r.battery_capacity_ah, 'Ah', 0)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{r.battery_string_count ?? '—'}</TableCell>
                  <TableCell>{yes(r.battery_damage)}</TableCell>
                  <TableCell>{yes(r.battery_water_top_up)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartCard>
        <ChartCard title="Solar" empty={sol.length === 0 && 'No solar readings recorded yet.'}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Site</TableHead>
                <TableHead className="text-right">Panels working</TableHead>
                <TableHead className="text-right">Damaged</TableHead>
                <TableHead>Operating normally</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sol.map((r) => (
                <TableRow key={r.site_id}>
                  <TableCell className="whitespace-nowrap">{r.site_code}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{r.panels_installed == null ? '—' : `${r.panels_operational ?? '—'}/${r.panels_installed}`}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{r.damaged_panel_count ?? '—'}</TableCell>
                  <TableCell>{r.solar_operating_normally == null ? '—' : r.solar_operating_normally ? 'Yes' : <Badge tone="danger">No</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartCard>
        <ChartCard title="Earthing" empty={rows.every((r) => !r.earthing_recorded_at) && 'No earthing inspections recorded yet.'}>
          <BarList
            items={[
              { label: 'Sites with abnormalities', value: rows.filter((r) => r.earthing_abnormalities).length, color: 'var(--status-critical)' },
              { label: 'Sites without abnormalities', value: rows.filter((r) => r.earthing_abnormalities === false).length, color: 'var(--status-good)' },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {rows.filter((r) => r.earthing_abnormalities).map((r) => r.site_code).join(', ') || 'No abnormalities reported.'}
          </p>
        </ChartCard>
      </div>
    </div>
  );
}

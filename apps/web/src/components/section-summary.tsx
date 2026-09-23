import { dcHighLoad, dcPowerKw, totalPhaseCurrentA, type DcThresholds, type Enums } from '@ipt/shared';
import type { VisitAnalytics } from '@/lib/pm-visit';
import { cn } from '@/lib/utils';

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' | 'warning' }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'font-semibold tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </p>
    </div>
  );
}

const yn = (v: boolean | null | undefined, yes = 'Yes', no = 'No') => (v == null ? '—' : v ? yes : no);
const num = (v: number | null | undefined, unit = '', digits = 2) =>
  v == null ? '—' : `${Number(v.toFixed(digits))}${unit ? ` ${unit}` : ''}`;

/**
 * Section-specific summary built from the analytics tables the database
 * projects from the technician's answers. Calculated values are labelled.
 */
export function SectionSummary({
  category,
  analytics,
  dcThresholds,
}: {
  category: Enums<'pm_category'>;
  analytics: VisitAnalytics;
  /** Administrator-configured high-load thresholds; nothing is flagged when not configured. */
  dcThresholds?: DcThresholds | null;
}) {
  switch (category) {
    case 'GENERATOR': {
      const g = analytics.generator;
      if (!g) return null;
      return (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Engine oil changed" value={yn(g.engine_oil_changed)} />
          <Stat label="Fuel filter changed" value={yn(g.fuel_filter_changed)} />
          <Stat label="Oil filter changed" value={yn(g.oil_filter_changed)} />
          <Stat label="Needs service / CM" value={yn(g.requires_service)} tone={g.requires_service ? 'danger' : undefined} />
        </div>
      );
    }
    case 'DC_SYSTEM': {
      const d = analytics.dc;
      if (!d && analytics.phases.length === 0) return null;
      const kw = d?.dc_power_kw ?? dcPowerKw(d?.rectifier_voltage_v, d?.load_current_a);
      const phaseTotal = totalPhaseCurrentA(analytics.phases.map((p) => p.amp_value));
      const high = dcHighLoad(kw, d?.load_current_a, dcThresholds);
      return (
        <div className="space-y-3">
          {high.kw || high.current ? (
            <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm font-medium text-warning">
              High DC load:{' '}
              {[
                high.kw ? `power above the configured ${dcThresholds?.high_load_kw} kW` : null,
                high.current ? `load current above the configured ${dcThresholds?.high_load_current_a} A` : null,
              ]
                .filter(Boolean)
                .join('; ')}
              .
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="DC power (calculated V × A / 1000)" value={num(kw, 'kW', 3)} tone={high.kw ? 'warning' : undefined} />
            <Stat
              label="Modules operational / installed"
              value={d?.dc_modules_installed != null ? `${d.dc_modules_operational ?? '—'} / ${d.dc_modules_installed}` : '—'}
              tone={d && d.dc_modules_operational != null && d.dc_modules_installed != null && d.dc_modules_operational < d.dc_modules_installed ? 'warning' : undefined}
            />
            <Stat label="Sum of phase currents (calculated)" value={num(phaseTotal, 'A')} />
            <Stat label="Controller" value={d?.controller_model ?? '—'} />
          </div>
          {analytics.phases.length > 0 ? (
            <table className="w-full max-w-xl text-sm">
              <caption className="mb-1 text-left text-xs text-muted-foreground">Clamp meter amp load by phase (measured)</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">Phase</th>
                  <th className="py-1 font-medium">Current</th>
                  <th className="py-1 font-medium">Comment</th>
                </tr>
              </thead>
              <tbody>
                {analytics.phases.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1">Phase {p.phase_number}</td>
                    <td className="py-1 tabular-nums">{num(p.amp_value, p.unit)}</td>
                    <td className="py-1 text-muted-foreground">{p.comment ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      );
    }
    case 'BATTERY': {
      const b = analytics.battery;
      if (!b) return null;
      return (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Swelling / leakage / damage" value={yn(b.physical_damage_found)} tone={b.physical_damage_found ? 'danger' : undefined} />
          <Stat label="Water top-up required" value={yn(b.water_top_up_required)} tone={b.water_top_up_required ? 'warning' : undefined} />
        </div>
      );
    }
    case 'SOLAR': {
      const s = analytics.solar;
      if (!s) return null;
      return (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat
            label="Panels operational / installed"
            value={s.panels_installed != null ? `${s.panels_operational ?? '—'} / ${s.panels_installed}` : '—'}
            tone={s.panels_operational != null && s.panels_installed != null && s.panels_operational < s.panels_installed ? 'warning' : undefined}
          />
          <Stat label="Damaged panels" value={s.damaged_panel_count == null ? '—' : String(s.damaged_panel_count)} tone={s.damaged_panel_count ? 'danger' : undefined} />
          <Stat label="Panels cleaned during PM" value={yn(s.panels_cleaned)} />
          <Stat label="Operating normally" value={yn(s.system_operating_normally)} tone={s.system_operating_normally === false ? 'danger' : undefined} />
        </div>
      );
    }
    case 'EARTHING': {
      const e = analytics.earthing;
      if (!e) return null;
      return (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Earth cable connected" value={yn(e.earth_cable_connected)} tone={e.earth_cable_connected === false ? 'danger' : undefined} />
          <Stat label="Free from corrosion" value={yn(e.free_from_corrosion)} tone={e.free_from_corrosion === false ? 'danger' : undefined} />
          <Stat label="Pit acceptable" value={yn(e.pit_condition_acceptable)} tone={e.pit_condition_acceptable === false ? 'danger' : undefined} />
          <Stat label="Abnormalities" value={yn(e.abnormalities_found)} tone={e.abnormalities_found ? 'danger' : undefined} />
        </div>
      );
    }
    default:
      return null;
  }
}

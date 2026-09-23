import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth';
import { loadCompliance, loadFailureStats, loadLatestReadings, loadTechnicianStats, type ComplianceGroup, type FailureGroup } from '@/lib/analytics';
import { parseAnalyticsParams, pct, phaseImbalancePct } from '@/lib/analytics-params';
import { csvResponse, exportError } from '@/lib/csv-export';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const COMPLIANCE: ComplianceGroup[] = ['region', 'county', 'technician', 'supervisor', 'month'];
const FAILURES: FailureGroup[] = ['category', 'severity', 'month', 'item', 'site'];

/**
 * Analytics tables as CSV, for the same period and region as the page.
 *   ?dataset=compliance&group=region|county|technician|supervisor|month
 *   ?dataset=failures&group=category|severity|month|item|site
 *   ?dataset=technicians
 *   ?dataset=readings
 */
export async function GET(request: NextRequest) {
  await requireCapability('view_reports');
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const p = parseAnalyticsParams(sp, new Date());
  const dataset = sp.dataset ?? '';
  const group = sp.group ?? '';
  const supabase = await createClient();
  const filters = { dataset, group, from: p.from, to: p.to, region: p.region ?? '' };
  try {
    if (dataset === 'compliance' && (COMPLIANCE as string[]).includes(group)) {
      const rows = await loadCompliance(supabase, p.from, p.to, group as ComplianceGroup, p.region);
      return await csvResponse(supabase, `pm_compliance_by_${group}_csv`, filters, rows, [
        { header: group[0]!.toUpperCase() + group.slice(1), value: (r) => r.group_label },
        { header: 'Due', value: (r) => r.scheduled },
        { header: 'Completed', value: (r) => r.completed },
        { header: 'Completed On Time', value: (r) => r.on_time },
        { header: 'Overdue', value: (r) => r.overdue },
        { header: 'Compliance %', value: (r) => pct(r.completed, r.scheduled) },
        { header: 'On-time %', value: (r) => pct(r.on_time, r.scheduled) },
        { header: 'Period From', value: () => p.from },
        { header: 'Period To', value: () => p.to },
      ]);
    }
    if (dataset === 'failures' && (FAILURES as string[]).includes(group)) {
      const rows = await loadFailureStats(supabase, p.from, p.to, group as FailureGroup, p.region);
      return await csvResponse(supabase, `failures_by_${group}_csv`, filters, rows, [
        { header: group[0]!.toUpperCase() + group.slice(1), value: (r) => r.group_label ?? r.group_key },
        { header: 'Found', value: (r) => r.total },
        { header: 'Not Yet Verified', value: (r) => r.open },
        { header: 'Critical', value: (r) => r.critical },
        { header: 'Avg Hours To Resolve', value: (r) => r.avg_resolution_hours },
        { header: 'Period From', value: () => p.from },
        { header: 'Period To', value: () => p.to },
      ]);
    }
    if (dataset === 'technicians') {
      const rows = await loadTechnicianStats(supabase, p.from, p.to, p.region);
      return await csvResponse(supabase, 'technician_performance_csv', filters, rows, [
        { header: 'Technician', value: (r) => r.technician_name },
        { header: 'Region', value: (r) => r.region_name },
        { header: 'PMs Submitted', value: (r) => r.pm_submitted },
        { header: 'PMs Approved', value: (r) => r.pm_approved },
        { header: 'PMs Returned', value: (r) => r.pm_returned },
        { header: 'PMs Awaiting Review', value: (r) => r.pm_awaiting_review },
        { header: 'Avg PM Minutes', value: (r) => r.avg_pm_minutes },
        { header: 'Failures Found', value: (r) => r.failures_reported },
        { header: 'Actions Assigned', value: (r) => r.actions_assigned },
        { header: 'Actions Completed', value: (r) => r.actions_completed },
        { header: 'Actions Overdue', value: (r) => r.actions_overdue },
        { header: 'Period From', value: () => p.from },
        { header: 'Period To', value: () => p.to },
      ]);
    }
    if (dataset === 'readings') {
      const rows = await loadLatestReadings(supabase, p.region);
      return await csvResponse(supabase, 'latest_readings_csv', filters, rows, [
        { header: 'Site ID', value: (r) => r.site_code },
        { header: 'Site Name', value: (r) => r.site_name },
        { header: 'Region', value: (r) => r.region_name },
        { header: 'DC Recorded', value: (r) => r.dc_recorded_at },
        { header: 'Rectifier Voltage V', value: (r) => r.rectifier_voltage_v },
        { header: 'Load Current A', value: (r) => r.load_current_a },
        { header: 'DC Power kW (calculated)', value: (r) => r.dc_power_kw },
        { header: 'DC Modules Installed', value: (r) => r.dc_modules_installed },
        { header: 'DC Modules Operational', value: (r) => r.dc_modules_operational },
        { header: 'Phases Recorded', value: (r) => r.phase_count },
        { header: 'Phase Imbalance %', value: (r) => phaseImbalancePct(r.phase_min_a, r.phase_max_a, r.phase_total_a, r.phase_count) },
        { header: 'Generator Recorded', value: (r) => r.gen_recorded_at },
        { header: 'Running Hours', value: (r) => r.running_hours },
        { header: 'Fuel Level %', value: (r) => r.fuel_level_pct },
        { header: 'Oil Pressure bar', value: (r) => r.oil_pressure_bar },
        { header: 'Generator kVA', value: (r) => r.generator_kva },
        { header: 'Generator Needs Service', value: (r) => r.generator_requires_service },
        { header: 'Battery Recorded', value: (r) => r.battery_recorded_at },
        { header: 'Battery Voltage V', value: (r) => r.battery_voltage_v },
        { header: 'Battery Capacity Ah', value: (r) => r.battery_capacity_ah },
        { header: 'Battery Strings', value: (r) => r.battery_string_count },
        { header: 'Battery Damage', value: (r) => r.battery_damage },
        { header: 'Battery Water Top-up', value: (r) => r.battery_water_top_up },
        { header: 'Solar Panels Installed', value: (r) => r.panels_installed },
        { header: 'Solar Panels Operational', value: (r) => r.panels_operational },
        { header: 'Solar Damaged Panels', value: (r) => r.damaged_panel_count },
        { header: 'Solar Operating Normally', value: (r) => r.solar_operating_normally },
        { header: 'Earthing Abnormalities', value: (r) => r.earthing_abnormalities },
        { header: 'Demo', value: (r) => (r.is_demo ? 'YES' : 'NO') },
      ]);
    }
    return NextResponse.json({ error: 'Unknown dataset' }, { status: 400 });
  } catch (e) {
    return exportError((e as Error).message);
  }
}

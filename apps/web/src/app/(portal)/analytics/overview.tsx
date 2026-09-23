import { humanizeStatus, PM_CATEGORY_LABELS, type Database, type Enums } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CalendarCheck, CalendarX, Clock, Percent, TriangleAlert, Wrench } from 'lucide-react';
import { BarList } from '@/components/charts/bar-list';
import { ChartCard } from '@/components/charts/chart-card';
import { MonthlyColumns, MonthlyPercentLine } from '@/components/charts/time-charts';
import { KpiCard } from '@/components/kpi-card';
import { loadCompliance, loadFailureStats } from '@/lib/analytics';
import { monthsBetween, pct, type AnalyticsParams } from '@/lib/analytics-params';

type Client = SupabaseClient<Database>;

export const SEVERITY_COLOR: Record<Enums<'severity_level'>, string> = {
  LOW: 'var(--status-neutral)',
  MEDIUM: 'var(--status-warning)',
  HIGH: 'var(--status-serious)',
  CRITICAL: 'var(--status-critical)',
};
const SEVERITIES: Enums<'severity_level'>[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const fmtPct = (v: number | null) => (v == null ? '—' : `${v}%`);

export async function OverviewTab({ supabase, p }: { supabase: Client; p: AnalyticsParams }) {
  const [byMonth, byRegion, failCategory, failSeverity] = await Promise.all([
    loadCompliance(supabase, p.from, p.to, 'month', p.region),
    loadCompliance(supabase, p.from, p.to, 'region', p.region),
    loadFailureStats(supabase, p.from, p.to, 'category', p.region),
    loadFailureStats(supabase, p.from, p.to, 'severity', p.region),
  ]);
  const sum = (rows: { scheduled: number; completed: number; on_time: number; overdue: number }[], k: 'scheduled' | 'completed' | 'on_time' | 'overdue') =>
    rows.reduce((a, r) => a + r[k], 0);
  const scheduled = sum(byMonth, 'scheduled');
  const completed = sum(byMonth, 'completed');
  const onTime = sum(byMonth, 'on_time');
  const overdue = sum(byMonth, 'overdue');
  const failures = failCategory.reduce((a, r) => a + r.total, 0);
  const openFailures = failCategory.reduce((a, r) => a + r.open, 0);
  const resolved = failCategory.filter((r) => r.avg_resolution_hours != null);

  const monthIndex = new Map(byMonth.map((r) => [r.group_key, r]));
  const months = monthsBetween(p.from, p.to).map((m) => {
    const r = monthIndex.get(m);
    return { month: m, scheduled: r?.scheduled ?? 0, completed: r?.completed ?? 0, compliance: r ? pct(r.completed, r.scheduled) : null };
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="PM compliance" value={fmtPct(pct(completed, scheduled))} icon={Percent} tone="info" hint={`${completed} of ${scheduled} due PMs completed`} />
        <KpiCard label="Completed on time" value={fmtPct(pct(onTime, scheduled))} icon={CalendarCheck} tone="success" hint={`${onTime} submitted by the due date`} />
        <KpiCard label="Overdue PMs" value={overdue} icon={CalendarX} tone={overdue ? 'danger' : 'neutral'} hint="Due in the period, not completed" />
        <KpiCard label="Failures found" value={failures} icon={TriangleAlert} tone={failures ? 'warning' : 'neutral'} hint={`${openFailures} not yet verified`} />
        <KpiCard
          label="Average time to resolve"
          value={resolved.length ? `${Math.round(resolved.reduce((a, r) => a + Number(r.avg_resolution_hours) * r.total, 0) / resolved.reduce((a, r) => a + r.total, 0))} h` : '—'}
          icon={Clock}
          tone="neutral"
          hint="Detected → corrective action completed"
        />
        <KpiCard label="Critical failures" value={failSeverity.find((r) => r.group_key === 'CRITICAL')?.total ?? 0} icon={Wrench} tone="danger" hint="Detected in the period" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="PM compliance by month"
          description="Share of PMs due each month that were completed (submitted or approved)."
          empty={scheduled === 0 && 'No PM was due in this period.'}
          table={{ columns: ['Month', 'Due', 'Completed', 'Compliance'], rows: months.map((m) => [m.month, m.scheduled, m.completed, fmtPct(m.compliance)]) }}
        >
          <MonthlyPercentLine data={months} dataKey="compliance" name="Compliance" />
        </ChartCard>
        <ChartCard
          title="PMs due and completed"
          empty={scheduled === 0 && 'No PM was due in this period.'}
          table={{ columns: ['Month', 'Due', 'Completed'], rows: months.map((m) => [m.month, m.scheduled, m.completed]) }}
        >
          <MonthlyColumns
            data={months}
            series={[
              { key: 'scheduled', name: 'Due', color: 'var(--series-1)' },
              { key: 'completed', name: 'Completed', color: 'var(--series-2)' },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Compliance by region"
          empty={byRegion.length === 0 && 'No PM was due in this period.'}
          table={{
            columns: ['Region', 'Due', 'Completed', 'On time', 'Overdue', 'Compliance'],
            rows: byRegion.map((r) => [r.group_label, r.scheduled, r.completed, r.on_time, r.overdue, fmtPct(pct(r.completed, r.scheduled))]),
          }}
        >
          <BarList
            max={100}
            items={[...byRegion]
              .sort((a, b) => (pct(b.completed, b.scheduled) ?? -1) - (pct(a.completed, a.scheduled) ?? -1))
              .map((r) => ({ label: r.group_label, value: pct(r.completed, r.scheduled), display: `${fmtPct(pct(r.completed, r.scheduled))} · ${r.completed}/${r.scheduled}` }))}
          />
        </ChartCard>
        <ChartCard
          title="Failures by section"
          description="Failures detected in the period, from PM checklists and manual reports."
          empty={failures === 0 && 'No failures were found in this period.'}
          table={{ columns: ['Section', 'Found', 'Not yet verified', 'Critical'], rows: failCategory.map((r) => [PM_CATEGORY_LABELS[r.group_key as Enums<'pm_category'>] ?? r.group_key, r.total, r.open, r.critical]) }}
        >
          <BarList items={failCategory.map((r) => ({ label: PM_CATEGORY_LABELS[r.group_key as Enums<'pm_category'>] ?? r.group_key, value: r.total, href: `/failures?category=${r.group_key}&status=ALL` }))} />
        </ChartCard>
        <ChartCard
          title="Failures by severity"
          description="Severity is set per checklist item in PM Templates."
          empty={failures === 0 && 'No failures were found in this period.'}
          table={{ columns: ['Severity', 'Found', 'Not yet verified'], rows: failSeverity.map((r) => [humanizeStatus(r.group_key), r.total, r.open]) }}
        >
          <BarList
            items={SEVERITIES.map((s) => {
              const r = failSeverity.find((x) => x.group_key === s);
              return { label: humanizeStatus(s), value: r?.total ?? 0, color: SEVERITY_COLOR[s] };
            })}
          />
        </ChartCard>
      </div>
    </div>
  );
}

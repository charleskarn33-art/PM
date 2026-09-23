import type { Database } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BarList } from '@/components/charts/bar-list';
import { ChartCard } from '@/components/charts/chart-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { loadCompliance, loadTechnicianStats, type ComplianceRow } from '@/lib/analytics';
import { pct, type AnalyticsParams } from '@/lib/analytics-params';

type Client = SupabaseClient<Database>;
const fmtPct = (v: number | null) => (v == null ? '—' : `${v}%`);

function ComplianceTable({ rows, label }: { rows: ComplianceRow[]; label: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{label}</TableHead>
          <TableHead className="text-right">Due</TableHead>
          <TableHead className="text-right">Completed</TableHead>
          <TableHead className="text-right">On time</TableHead>
          <TableHead className="text-right">Overdue</TableHead>
          <TableHead className="text-right">Compliance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.group_key ?? r.group_label}>
            <TableCell>{r.group_label}</TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">{r.scheduled}</TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">{r.completed}</TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">{r.on_time}</TableCell>
            <TableCell className={r.overdue ? 'whitespace-nowrap text-right font-medium tabular-nums text-danger' : 'whitespace-nowrap text-right tabular-nums'}>{r.overdue}</TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtPct(pct(r.completed, r.scheduled))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export async function PeopleTab({ supabase, p }: { supabase: Client; p: AnalyticsParams }) {
  const [techs, byTech, bySupervisor, byCounty] = await Promise.all([
    loadTechnicianStats(supabase, p.from, p.to, p.region),
    loadCompliance(supabase, p.from, p.to, 'technician', p.region),
    loadCompliance(supabase, p.from, p.to, 'supervisor', p.region),
    loadCompliance(supabase, p.from, p.to, 'county', p.region),
  ]);
  const onTimeBy = new Map(byTech.map((r) => [r.group_key, r]));

  return (
    <div className="space-y-6">
      <ChartCard
        title="On-time PM completion by technician"
        description="PMs due in the period that were submitted by their due date."
        empty={byTech.length === 0 && 'No PM was due in this period.'}
      >
        <BarList
          max={100}
          items={[...byTech]
            .sort((a, b) => (pct(b.on_time, b.scheduled) ?? -1) - (pct(a.on_time, a.scheduled) ?? -1))
            .map((r) => ({ label: r.group_label, value: pct(r.on_time, r.scheduled), display: `${fmtPct(pct(r.on_time, r.scheduled))} · ${r.on_time}/${r.scheduled}` }))}
        />
      </ChartCard>

      <ChartCard title="Technician performance" description="Work done in the period. Returned = PMs currently sent back for correction.">
        {techs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active technicians in scope.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Technician</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">PMs due</TableHead>
                  <TableHead className="text-right">Submitted</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">Awaiting review</TableHead>
                  <TableHead className="text-right">Avg PM time</TableHead>
                  <TableHead className="text-right">Failures found</TableHead>
                  <TableHead className="text-right">Actions done</TableHead>
                  <TableHead className="text-right">Actions overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {techs.map((t) => (
                  <TableRow key={t.technician_id}>
                    <TableCell className="whitespace-nowrap font-medium">{t.technician_name}</TableCell>
                    <TableCell className="whitespace-nowrap">{t.region_name ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{onTimeBy.get(t.technician_id)?.scheduled ?? 0}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{t.pm_submitted}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{t.pm_approved}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{t.pm_returned}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{t.pm_awaiting_review}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{t.avg_pm_minutes == null ? '—' : `${t.avg_pm_minutes} min`}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{t.failures_reported}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {t.actions_completed}/{t.actions_assigned}
                    </TableCell>
                    <TableCell className={t.actions_overdue ? 'whitespace-nowrap text-right font-medium tabular-nums text-danger' : 'whitespace-nowrap text-right tabular-nums'}>{t.actions_overdue}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ChartCard>

      <div className="grid gap-6 2xl:grid-cols-2">
        <ChartCard title="Compliance by supervisor" empty={bySupervisor.length === 0 && 'No PM was due in this period.'}>
          <ComplianceTable rows={bySupervisor} label="Supervisor" />
        </ChartCard>
        <ChartCard title="Compliance by county" empty={byCounty.length === 0 && 'No PM was due in this period.'}>
          <ComplianceTable rows={byCounty} label="County" />
        </ChartCard>
      </div>
    </div>
  );
}

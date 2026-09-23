import type { Database } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BarList } from '@/components/charts/bar-list';
import { ChartCard } from '@/components/charts/chart-card';
import { MonthlyColumns } from '@/components/charts/time-charts';
import { loadFailureStats } from '@/lib/analytics';
import { monthsBetween, type AnalyticsParams } from '@/lib/analytics-params';

type Client = SupabaseClient<Database>;

export async function FailuresTab({ supabase, p }: { supabase: Client; p: AnalyticsParams }) {
  const [byMonth, byItem, bySite] = await Promise.all([
    loadFailureStats(supabase, p.from, p.to, 'month', p.region),
    loadFailureStats(supabase, p.from, p.to, 'item', p.region),
    loadFailureStats(supabase, p.from, p.to, 'site', p.region),
  ]);
  const idx = new Map(byMonth.map((r) => [r.group_key, r]));
  const months = monthsBetween(p.from, p.to).map((m) => ({ month: m, total: idx.get(m)?.total ?? 0, open: idx.get(m)?.open ?? 0 }));
  const none = byMonth.length === 0 && 'No failures were found in this period.';
  const hours = (v: number | null) => (v == null ? '—' : `${v} h`);

  return (
    <div className="space-y-6">
      <ChartCard
        title="Failures found by month"
        description="Of those, how many are not yet verified as fixed."
        empty={none}
        table={{ columns: ['Month', 'Found', 'Not yet verified'], rows: months.map((m) => [m.month, m.total, m.open]) }}
      >
        <MonthlyColumns
          data={months}
          series={[
            { key: 'total', name: 'Found', color: 'var(--series-1)' },
            { key: 'open', name: 'Not yet verified', color: 'var(--series-2)' },
          ]}
        />
      </ChartCard>
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Most frequent failures"
          description="Checklist items that failed most often (top 10)."
          empty={none}
          table={{ columns: ['Item', 'Found', 'Critical', 'Avg time to resolve'], rows: byItem.map((r) => [r.group_label ?? '', r.total, r.critical, hours(r.avg_resolution_hours)]) }}
        >
          <BarList items={byItem.slice(0, 10).map((r) => ({ label: r.group_label ?? r.group_key, value: r.total }))} />
        </ChartCard>
        <ChartCard
          title="Sites with the most failures"
          description="Top 10 sites; open the failures list to act on them."
          empty={none}
          table={{ columns: ['Site', 'Found', 'Not yet verified', 'Critical'], rows: bySite.map((r) => [r.group_label ?? '', r.total, r.open, r.critical]) }}
        >
          <BarList
            items={bySite.slice(0, 10).map((r) => ({
              label: r.group_label ?? r.group_key,
              value: r.total,
              note: r.open ? `${r.open} open` : undefined,
              href: `/sites/${r.group_key}`,
            }))}
          />
        </ChartCard>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { requireCapability } from '@/lib/auth';
import { parseAnalyticsParams, PRESETS, TABS, type AnalyticsParams } from '@/lib/analytics-params';
import { loadRegions } from '@/lib/org-data';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import { EquipmentTab } from './equipment';
import { FailuresTab } from './failures';
import { OverviewTab } from './overview';
import { PeopleTab } from './people';

export const metadata: Metadata = { title: 'Analytics' };

function hrefFor(p: AnalyticsParams, tab: string): string {
  const q = new URLSearchParams({ tab, period: p.preset });
  if (p.preset === 'custom') {
    q.set('from', p.from);
    q.set('to', p.to);
  }
  if (p.region) q.set('region', p.region);
  return `/analytics?${q.toString()}`;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  await requireCapability('view_reports');
  const p = parseAnalyticsParams(sp, new Date());
  const supabase = await createClient();
  const regions = (await loadRegions(supabase)).filter((r) => r.is_active);
  const regionName = regions.find((r) => r.id === p.region)?.name;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description={`${p.label} (${p.from} to ${p.to})${regionName ? ` · ${regionName}` : ''}. Figures cover the regions you can see; only submitted and approved PMs count as recorded readings.`}
      />

      {/* One filter row scopes every figure below it. */}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <input type="hidden" name="tab" value={p.tab} />
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Period</span>
          <Select name="period" defaultValue={p.preset} className="w-44">
            {PRESETS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">From (custom)</span>
          <Input type="date" name="from" defaultValue={p.from} className="w-40" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">To (custom)</span>
          <Input type="date" name="to" defaultValue={p.to} className="w-40" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Region</span>
          <Select name="region" defaultValue={p.region ?? ''} className="w-48">
            <option value="">All my regions</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit">Apply</Button>
        <Link href="/analytics" className={buttonVariants({ variant: 'ghost' })}>
          Reset
        </Link>
      </form>

      <nav aria-label="Analytics sections" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={hrefFor(p, t.id)}
            aria-current={p.tab === t.id ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              p.tab === t.id ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {p.tab === 'overview' ? <OverviewTab supabase={supabase} p={p} /> : null}
      {p.tab === 'people' ? <PeopleTab supabase={supabase} p={p} /> : null}
      {p.tab === 'failures' ? <FailuresTab supabase={supabase} p={p} /> : null}
      {p.tab === 'equipment' ? <EquipmentTab supabase={supabase} p={p} /> : null}
    </div>
  );
}

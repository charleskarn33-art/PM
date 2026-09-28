import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { ApiError } from '@/lib/api/client';
import { loadOptional, qs } from '@/lib/api/data';
import { api } from '@/lib/api/server';
import type { Region } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { CompletionView } from './completion-view';
import { FailuresView } from './failures-view';
import { PowerView } from './power-view';
import type { Completion, FailureAnalytics, Power } from './types';

export const metadata: Metadata = { title: 'Analytics' };

const VIEWS = [
  ['completion', 'PM completion'],
  ['power', 'Power systems'],
  ['failures', 'Failures'],
] as const;
type View = (typeof VIEWS)[number][0];
const BY = [
  ['region', 'Region'],
  ['county', 'County'],
  ['technician', 'Technician'],
] as const;

/** The view's figures, or the API's message when the range is not accepted. */
async function fetchView<T>(path: string): Promise<T | string> {
  try {
    return (await api<T>(path)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) return e.message;
    throw e;
  }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const month = (v: string | undefined) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : undefined);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const session = await requirePermission('analytics.read');
  const view: View = VIEWS.some(([v]) => v === one(sp.view)) ? (one(sp.view) as View) : 'completion';
  const by = BY.some(([v]) => v === one(sp.by)) ? one(sp.by)! : 'region';
  const filters = { from: month(one(sp.from)), to: month(one(sp.to)), regionId: one(sp.regionId) };
  const query = qs({ ...filters, ...(view === 'completion' ? { by } : {}) });

  const [regions, completion, power, failures] = await Promise.all([
    loadOptional<Region[]>('/org/hierarchy'),
    view === 'completion' ? fetchView<Completion>(`/analytics/completion${query}`) : null,
    view === 'power' ? fetchView<Power>(`/analytics/power${query}`) : null,
    view === 'failures' ? fetchView<FailureAnalytics>(`/analytics/failures${query}`) : null,
  ]);
  const result = completion ?? power ?? failures;
  const problem = typeof result === 'string' ? result : null;
  const range = typeof result === 'string' || !result ? { from: filters.from, to: filters.to } : result.range;
  const canConfigure = hasPermission(session, 'settings.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Counted by the API from PM schedules, finished PM visits and failures in your scope. Readings come only from completed or approved PMs; nothing is estimated."
      />

      <nav aria-label="Analytics views" className="flex gap-1 border-b">
        {VIEWS.map(([v, label]) => (
          <Link
            key={v}
            href={`/analytics${qs({ view: v, ...filters, by: v === 'completion' && by !== 'region' ? by : undefined })}`}
            aria-current={v === view ? 'page' : undefined}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm', v === view ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {label}
          </Link>
        ))}
      </nav>

      <form method="get" className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <input type="hidden" name="view" value={view} />
        <div className="space-y-1.5">
          <Label htmlFor="from">From month</Label>
          <Input id="from" name="from" type="month" defaultValue={range.from} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To month</Label>
          <Input id="to" name="to" type="month" defaultValue={range.to} />
        </div>
        {regions && regions.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="regionId">Region</Label>
            <Select id="regionId" name="regionId" defaultValue={filters.regionId ?? ''}>
              <option value="">All in your scope</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {view === 'completion' ? (
          <div className="space-y-1.5">
            <Label htmlFor="by">Group by</Label>
            <Select id="by" name="by" defaultValue={by}>
              {BY.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          <Link href={`/analytics${qs({ view })}`} className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">Up to 24 months at a time. Without dates, the last 6 months are shown.</p>
      </form>

      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {completion && typeof completion !== 'string' ? <CompletionView d={completion} canConfigure={canConfigure} /> : null}
      {power && typeof power !== 'string' ? <PowerView d={power} canConfigure={canConfigure} /> : null}
      {failures && typeof failures !== 'string' ? <FailuresView d={failures} /> : null}
    </div>
  );
}

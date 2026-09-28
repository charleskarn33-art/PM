import { PM_CATEGORY_LABELS } from '@ipt/shared';
import { CheckCheck, Timer, TriangleAlert } from 'lucide-react';
import { BarList } from '@/components/charts/bar-list';
import { LineChart } from '@/components/charts/line-chart';
import { KpiCard } from '@/components/kpi-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { monthLabel, num, type FailureAnalytics } from './types';

const SEVERITY_COLOR: Record<string, string> = { CRITICAL: 'var(--status-critical)', HIGH: 'var(--status-serious)', MEDIUM: 'var(--status-warning)', LOW: 'var(--status-neutral)' };
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function FailuresView({ d }: { d: FailureAnalytics }) {
  const categories = Object.entries(d.byCategory)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const days = (v: number | null) => (v == null ? '—' : `${num(v, 1)} ${v === 1 ? 'day' : 'days'}`);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Detected" value={d.detected} icon={TriangleAlert} tone="warning" hint={`${monthLabel(d.range.from)} – ${monthLabel(d.range.to)}`} />
        <KpiCard label="Closed" value={d.closed} icon={CheckCheck} tone="success" hint="Closed in the period" />
        <KpiCard label="Open now" value={d.openNow} icon={TriangleAlert} tone={d.openNow ? 'danger' : 'neutral'} hint="Not closed, any date" />
        <KpiCard label="Time to close" value={days(d.timeToClose.meanDays)} icon={Timer} tone="info" hint={d.timeToClose.count ? `Mean of ${d.timeToClose.count}; median ${days(d.timeToClose.medianDays)}` : 'Nothing closed in the period'} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failures detected and closed by month</CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart
            title="Failures detected and closed per month"
            series={[
              { key: 'detected', label: 'Detected', color: 'var(--series-1)' },
              { key: 'closed', label: 'Closed', color: 'var(--series-2)' },
            ]}
            data={d.trend.map((m) => ({ label: monthLabel(m.month), values: { detected: m.detected, closed: m.closed } }))}
            decimals={0}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detected by severity</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList items={(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((s) => ({ label: title(s), value: d.bySeverity[s], color: SEVERITY_COLOR[s] }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detected by PM section</CardTitle>
          </CardHeader>
          <CardContent>
            {categories.length ? (
              <BarList items={categories.map(([c, n]) => ({ label: PM_CATEGORY_LABELS[c as keyof typeof PM_CATEGORY_LABELS] ?? (c === 'UNSPECIFIED' ? 'Not specified' : c), value: n }))} />
            ) : (
              <p className="text-sm text-muted-foreground">No failures detected in this period.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sites with the most failures</CardTitle>
            <CardDescription>Detected in the period (open ones in brackets).</CardDescription>
          </CardHeader>
          <CardContent>
            {d.topSites.length ? (
              <BarList items={d.topSites.map((s) => ({ label: `${s.site.siteCode} · ${s.site.siteName}`, value: s.count, href: `/sites/${s.site.id}`, note: s.open ? `${s.open} open` : undefined }))} />
            ) : (
              <p className="text-sm text-muted-foreground">No failures detected in this period.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Most frequent checklist failures</CardTitle>
            <CardDescription>Checklist questions answered as failed most often in the period.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.topItems.length ? (
              <BarList items={d.topItems.map((i) => ({ label: i.prompt, value: i.count }))} />
            ) : (
              <p className="text-sm text-muted-foreground">No checklist failures in this period.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

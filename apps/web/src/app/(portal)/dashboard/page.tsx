import { PM_CATEGORY_LABELS, PM_STATUS_TONE, SEVERITY_TONE } from '@ipt/shared';
import { CalendarCheck, CalendarClock, CalendarX, ClipboardCheck, Info, MapPin, Percent, ShieldAlert, TriangleAlert, Undo2, Wrench } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BarList } from '@/components/charts/bar-list';
import { KpiCard } from '@/components/kpi-card';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import { requirePermission } from '@/lib/auth';
import { formatDate, formatDateTime, pct } from '@/lib/format';

export const metadata: Metadata = { title: 'Dashboard' };

interface Dashboard {
  asOf: string;
  month: { from: string; to: string };
  sites: { total: number; active: number; demo: number };
  pm: { dueThisMonth: number; completedThisMonth: number; completionRatePct: number | null; overdue: number; inProgress: number; awaitingReview: number; returnedForCorrection: number };
  failures: { open: number; bySeverity: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number>; byCategory: Record<string, number>; newLast30Days: number };
  correctiveActions: { active: number; overdue: number; awaitingVerification: number };
  recentVisits: { id: string; status: keyof typeof PM_STATUS_TONE; completedAt: string | null; completionPct: number; failureCount: number; site: { id: string; siteCode: string; siteName: string }; technician: { fullName: string } }[];
  recentFailures: { id: string; number: string; title: string; severity: keyof typeof SEVERITY_TONE; detectedAt: string; site: { siteCode: string } }[];
}

const SEVERITY_COLOR: Record<string, string> = { CRITICAL: 'var(--danger)', HIGH: 'var(--danger)', MEDIUM: 'var(--warning)', LOW: 'var(--neutral)' };

/** KPI dashboard: every number is counted by the API from live records in the user's scope. */
export default async function DashboardPage() {
  const session = await requirePermission('analytics.read');
  const d = await load<Dashboard>('/dashboard');
  const month = new Date(`${d.month.from}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const scope = session.isGlobal ? 'All regions' : session.regionNames.length ? session.regionNames.join(', ') : 'Your assigned sites';
  const categories = Object.entries(d.failures.byCategory).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{scope}</p>
        </div>
        <p className="text-sm text-muted-foreground">As of {formatDate(d.asOf)}</p>
      </div>

      {d.sites.demo > 0 ? (
        <Alert tone="info" className="flex items-start gap-2">
          <Info className="mt-0.5" aria-hidden />
          <span>
            {d.sites.demo} demo site{d.sites.demo === 1 ? ' is' : 's are'} included (seeded from the Tienii 1301 reference report). Demo records are not live operational data.
          </span>
        </Alert>
      ) : null}

      <section aria-labelledby="pm-heading" className="space-y-3">
        <h2 id="pm-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Preventive maintenance — due in {month}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <KpiCard label="Sites" value={d.sites.total} icon={MapPin} hint={`${d.sites.active} active`} />
          <KpiCard label="PM due this month" value={d.pm.dueThisMonth} icon={CalendarClock} tone="info" hint="Not cancelled" />
          <KpiCard label="PM completed" value={d.pm.completedThisMonth} icon={CalendarCheck} tone="success" hint="Due this month, completed or approved" />
          <KpiCard label="Completion" value={pct(d.pm.completionRatePct)} icon={Percent} tone="success" hint={d.pm.completionRatePct === null ? 'No PM due this month' : undefined} />
          <KpiCard label="PM overdue" value={d.pm.overdue} icon={CalendarX} tone={d.pm.overdue ? 'danger' : 'neutral'} hint="All months" />
          <KpiCard label="PM in progress" value={d.pm.inProgress} icon={ClipboardCheck} tone="info" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/visits?status=COMPLETED" className="block">
            <KpiCard label="Waiting for review" value={d.pm.awaitingReview} icon={ClipboardCheck} tone={d.pm.awaitingReview ? 'warning' : 'neutral'} hint="Completed PMs to approve or return" />
          </Link>
          <Link href="/visits?status=REJECTED" className="block">
            <KpiCard label="Returned for correction" value={d.pm.returnedForCorrection} icon={Undo2} tone="neutral" />
          </Link>
        </div>
      </section>

      <section aria-labelledby="issues-heading" className="space-y-3">
        <h2 id="issues-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Failures and corrective actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Open failures" value={d.failures.open} icon={TriangleAlert} tone={d.failures.open ? 'warning' : 'neutral'} hint="Not closed" />
          <KpiCard label="Critical" value={d.failures.bySeverity.CRITICAL} icon={ShieldAlert} tone={d.failures.bySeverity.CRITICAL ? 'danger' : 'neutral'} hint="Open, severity critical" />
          <KpiCard label="New failures" value={d.failures.newLast30Days} icon={TriangleAlert} tone="info" hint="Last 30 days" />
          <KpiCard label="Active corrective actions" value={d.correctiveActions.active} icon={Wrench} tone="info" hint={`${d.correctiveActions.awaitingVerification} waiting for verification`} />
          <KpiCard label="Overdue actions" value={d.correctiveActions.overdue} icon={Wrench} tone={d.correctiveActions.overdue ? 'danger' : 'neutral'} hint="Past the due date, not completed" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open failures by severity</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              items={(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((s) => ({ label: s.charAt(0) + s.slice(1).toLowerCase(), value: d.failures.bySeverity[s], color: SEVERITY_COLOR[s], href: `/failures?status=active&severity=${s}` }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open failures by PM section</CardTitle>
          </CardHeader>
          <CardContent>
            {categories.length ? (
              <BarList items={categories.map(([c, n]) => ({ label: PM_CATEGORY_LABELS[c as keyof typeof PM_CATEGORY_LABELS] ?? (c === 'UNSPECIFIED' ? 'Not specified' : c), value: n }))} />
            ) : (
              <p className="text-sm text-muted-foreground">No open failures.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest completed PMs</CardTitle>
          </CardHeader>
          <CardContent>
            {d.recentVisits.length ? (
              <ul className="divide-y text-sm">
                {d.recentVisits.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/visits/${v.id}`} className="min-w-0 truncate hover:underline">
                      {v.site.siteCode} · {v.site.siteName} — {v.technician.fullName}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      {formatDateTime(v.completedAt)}
                      <StatusBadge status={v.status} tone={PM_STATUS_TONE[v.status]} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No PM completed yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest open failures</CardTitle>
          </CardHeader>
          <CardContent>
            {d.recentFailures.length ? (
              <ul className="divide-y text-sm">
                {d.recentFailures.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/failures/${f.id}`} className="min-w-0 truncate hover:underline">
                      {f.number} · {f.site.siteCode} — {f.title}
                    </Link>
                    <StatusBadge status={f.severity} tone={SEVERITY_TONE[f.severity]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No open failures.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">Trend charts (completion by region, county and technician, DC load, battery and generator) arrive with Analytics in Phase 10.</p>
    </div>
  );
}

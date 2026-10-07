import { humanizeStatus, PM_STATUS_TONE, SEVERITY_TONE, FAILURE_STATUS_TONE } from '@ipt/shared';
import { History, Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { load, loadAll, loadOptional, loadPage } from '@/lib/api/data';
import type { Assignment, FailureSummary, Schedule, Site, UserSummary, VisitSummary } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { AssignForm, EndAssignmentForm } from './assignment-forms';

export const metadata: Metadata = { title: 'Site' };

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePermission('sites.read');
  const can = (p: string) => hasPermission(session, p);
  const site = await load<Site>(`/sites/${id}`);
  const managesRegion = session.isGlobal || session.regionIds.includes(site.regionId);
  const [assignments, schedules, visits, failures, technicians, supervisors] = await Promise.all([
    can('assignments.read') ? loadOptional<Assignment[]>(`/sites/${id}/assignments`) : null,
    can('pm_schedules.read') ? loadPage<Schedule>(`/pm-schedules?siteId=${id}&pageSize=10`) : null,
    can('pm_visits.read') ? loadPage<VisitSummary>(`/visits?siteId=${id}&pageSize=10`) : null,
    can('failures.read') ? loadPage<FailureSummary>(`/failures?siteId=${id}&status=active&pageSize=10`) : null,
    can('assignments.manage') && can('users.read') && managesRegion ? loadAll<UserSummary>('/users?role=TECHNICIAN&active=true') : Promise.resolve([]),
    can('assignments.manage') && session.isGlobal ? loadAll<UserSummary>('/users?role=REGIONAL_SUPERVISOR&active=true') : Promise.resolve([]),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const lat = site.latitude == null ? null : Number(site.latitude);
  const lng = site.longitude == null ? null : Number(site.longitude);
  const active = (assignments ?? []).filter((a) => a.active);
  const history = (assignments ?? []).filter((a) => !a.active);
  const canAssign = can('assignments.manage') && managesRegion && site.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${site.siteCode} · ${site.siteName}`}
        description={[site.region?.name, site.cluster?.name, site.county?.name].filter(Boolean).join(' · ')}
        actions={
          <>
            {can('audit.read') ? (
              <Link href={`/admin/audit?entityType=site&entityId=${site.id}`} className={buttonVariants({ variant: 'ghost' })}>
                <History aria-hidden />
                History
              </Link>
            ) : null}
            {can('sites.manage') && session.isGlobal ? (
              <Link href={`/sites/${site.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
                <Pencil aria-hidden />
                Edit
              </Link>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={site.status === 'ACTIVE' ? 'success' : 'neutral'}>{humanizeStatus(site.status)}</Badge>
        {site.isDemo ? <Badge tone="neutral">Demo data</Badge> : null}
        <Badge tone={site.overview.openFailures ? 'danger' : 'neutral'}>{site.overview.openFailures} open failures</Badge>
        <Badge tone={site.overview.openActions ? 'warning' : 'neutral'}>{site.overview.openActions} open corrective actions</Badge>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Coordinates</dt>
              <dd>{lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'Not recorded'}</dd>
              <dt className="text-muted-foreground">Address</dt>
              <dd>{site.address ?? '—'}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd>{site.siteType ?? '—'}</dd>
              <dt className="text-muted-foreground">PM start radius</dt>
              <dd>{site.geofenceRadiusM ? `${site.geofenceRadiusM} m` : 'System setting'}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Power equipment</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Generator</dt>
              <dd>{yesNo(site.generatorAvailable)}</dd>
              <dt className="text-muted-foreground">Solar</dt>
              <dd>{yesNo(site.solarAvailable)}</dd>
              <dt className="text-muted-foreground">Grid</dt>
              <dd>{yesNo(site.gridAvailable)}</dd>
              <dt className="text-muted-foreground">Batteries</dt>
              <dd>{site.batteryUnitCount ? `${site.batteryUnitCount} (each recorded)` : (site.batteryConfiguration ?? '—')}</dd>
              <dt className="text-muted-foreground">Power</dt>
              <dd>{site.powerConfiguration ?? '—'}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PM</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Last completed</dt>
              <dd>{formatDateTime(site.overview.lastPmAt)}</dd>
              <dt className="text-muted-foreground">Next</dt>
              <dd>
                {site.overview.nextPm ? (
                  <span className="flex items-center gap-2">
                    {formatDate(site.overview.nextPm.dueDate)} <StatusBadge status={site.overview.nextPm.status} tone={PM_STATUS_TONE[site.overview.nextPm.status]} />
                  </span>
                ) : (
                  'Not scheduled'
                )}
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      {assignments ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">People</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {active.length ? (
              <ul className="divide-y text-sm">
                {active.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{a.user.fullName}</span> — {a.role === 'SUPERVISOR' ? 'Supervisor' : 'Technician'} since {formatDate(a.startDate)}
                    </span>
                    {canAssign && (a.role === 'TECHNICIAN' || session.isGlobal) ? <EndAssignmentForm siteId={site.id} assignmentId={a.id} today={today} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nobody is assigned to this site.</p>
            )}
            {canAssign ? <AssignForm siteId={site.id} role="TECHNICIAN" people={technicians.filter((t) => !active.some((a) => a.user.id === t.id))} today={today} /> : null}
            {canAssign && session.isGlobal ? <AssignForm siteId={site.id} role="SUPERVISOR" people={supervisors} today={today} /> : null}
            {history.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Earlier assignments ({history.length})</summary>
                <ul className="mt-2 space-y-1">
                  {history.map((a) => (
                    <li key={a.id}>
                      {a.user.fullName} — {a.role === 'SUPERVISOR' ? 'Supervisor' : 'Technician'}, {formatDate(a.startDate)} to {formatDate(a.endDate)}
                      {a.endReason ? ` (${a.endReason})` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        {schedules ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">PM schedule</CardTitle>
            </CardHeader>
            <CardContent>
              {schedules.items.length ? (
                <ul className="divide-y text-sm">
                  {schedules.items.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/schedule/${s.id}`} className="hover:underline">
                        Due {formatDate(s.dueDate)} — {s.technician?.fullName ?? 'Unassigned'}
                      </Link>
                      <StatusBadge status={s.status} tone={PM_STATUS_TONE[s.status]} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No PM scheduled.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
        {visits ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">PM visits</CardTitle>
              <Link href={`/sites/${site.id}/history`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                Full PM history{visits.total > visits.items.length ? ` (${visits.total})` : ''}
              </Link>
            </CardHeader>
            <CardContent>
              {visits.items.length ? (
                <ul className="divide-y text-sm">
                  {visits.items.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/visits/${v.id}`} className="hover:underline">
                        {formatDate(v.startedAt)} — {v.technician.fullName} · {Math.floor(v.completionPct)}%
                      </Link>
                      <StatusBadge status={v.status} tone={PM_STATUS_TONE[v.status]} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No visits yet.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
        {failures ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Open failures</CardTitle>
            </CardHeader>
            <CardContent>
              {failures.items.length ? (
                <ul className="divide-y text-sm">
                  {failures.items.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/failures/${f.id}`} className="min-w-0 truncate hover:underline">
                        {f.number} — {f.title}
                      </Link>
                      <span className="flex shrink-0 gap-1">
                        <StatusBadge status={f.severity} tone={SEVERITY_TONE[f.severity]} />
                        <StatusBadge status={f.status} tone={FAILURE_STATUS_TONE[f.status]} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No open failures.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

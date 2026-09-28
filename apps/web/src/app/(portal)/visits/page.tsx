import { PM_STATUS_TONE } from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination } from '@/components/data-table/pagination';
import { EmptyRow } from '@/components/empty-row';
import { ExportLink } from '@/components/export-link';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { loadAll, loadPage, qs } from '@/lib/api/data';
import type { UserSummary, VisitSummary } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'PM Visits & Review' };

const STATUSES = [
  ['COMPLETED', 'Waiting for review'],
  ['IN_PROGRESS', 'In progress'],
  ['REJECTED', 'Returned for correction'],
  ['APPROVED', 'Approved'],
] as const;

export default async function VisitsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requirePermission('pm_visits.read');
  const p = parseTableParams(sp, { sortable: ['started'] as const, defaultSort: 'started', filters: ['status', 'technician', 'site', 'from', 'to'] });
  const f = p.filters;
  const [page, technicians] = await Promise.all([
    loadPage<VisitSummary>(`/visits${qs({ status: f.status, technicianId: f.technician, siteId: f.site, from: f.from, to: f.to, page: p.page, pageSize: p.pageSize })}`),
    hasPermission(session, 'users.read') ? loadAll<UserSummary>('/users?role=TECHNICIAN') : Promise.resolve([] as UserSummary[]),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="PM Visits & Review"
        description="PM visits in your scope, latest first. Completed visits wait for a supervisor to approve them or return them for correction."
        actions={
          hasPermission(session, 'reports.export') ? (
            <ExportLink dataset="visits" query={qs({ status: f.status, technicianId: f.technician, siteId: f.site, from: f.from, to: f.to })} />
          ) : null
        }
      />
      <form method="get" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-5 md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={f.status ?? ''}>
            <option value="">Any</option>
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        {technicians.length ? (
          <div className="space-y-1.5">
            <Label htmlFor="technician">Technician</Label>
            <Select id="technician" name="technician" defaultValue={f.technician ?? ''}>
              <option value="">Anyone</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="from">Started from</Label>
          <Input id="from" name="from" type="date" defaultValue={f.from ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">to</Label>
          <Input id="to" name="to" type="date" defaultValue={f.to ?? ''} />
        </div>
        <div className="flex gap-2">
          {f.site ? <input type="hidden" name="site" value={f.site} /> : null}
          <Button type="submit">Apply</Button>
          <Link href="/visits" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Site</TableHead>
            <TableHead>Technician</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead className="text-right">Complete</TableHead>
            <TableHead className="text-right">Failures</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.length === 0 ? (
            <EmptyRow colSpan={7} message="No visits match these filters." />
          ) : (
            page.items.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">
                  <Link href={`/visits/${v.id}`} className="hover:underline">
                    {v.site.siteCode} · {v.site.siteName}
                  </Link>
                  {v.isDemo ? (
                    <Badge tone="neutral" className="ml-2">
                      Demo
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{v.technician.fullName}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(v.startedAt)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(v.completedAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{Math.floor(v.completionPct)}%</TableCell>
                <TableCell className="text-right">
                  <Badge tone={v.failureCount ? 'danger' : 'neutral'}>{v.failureCount}</Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={v.status === 'COMPLETED' ? 'WAITING_FOR_REVIEW' : v.status} tone={PM_STATUS_TONE[v.status]} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/visits" searchParams={sp} page={p.page} pageSize={p.pageSize} total={page.total} />
    </div>
  );
}

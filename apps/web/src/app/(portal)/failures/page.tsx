import { FAILURE_STATUS_TONE, PM_CATEGORY_LABELS, SEVERITY_TONE } from '@ipt/shared';
import { Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination } from '@/components/data-table/pagination';
import { EmptyRow } from '@/components/empty-row';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { loadPage, qs } from '@/lib/api/data';
import type { FailureSummary } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Failures' };

const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED'] as const;

export default async function FailuresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requirePermission('failures.read');
  const p = parseTableParams(sp, { sortable: ['detected'] as const, defaultSort: 'detected', filters: ['status', 'severity', 'source', 'site', 'visit', 'from', 'to'] });
  const f = p.filters;
  const status = f.status ?? (sp.status === undefined ? 'active' : undefined);
  const page = await loadPage<FailureSummary>(
    `/failures${qs({ status, severity: f.severity, source: f.source, siteId: f.site, visitId: f.visit, q: p.q, from: f.from, to: f.to, page: p.page, pageSize: p.pageSize })}`,
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Failures"
        description="Failures recorded from completed PMs or reported on site, in your scope. Open failures are shown first by default."
        actions={
          hasPermission(session, 'failures.report') ? (
            <Link href="/failures/new" className={buttonVariants({ variant: 'accent' })}>
              <Plus aria-hidden />
              Report failure
            </Link>
          ) : null
        }
      />
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-6">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={p.q} placeholder="Title or number (FL-000012)" className="pl-9" aria-label="Search failures" />
        </div>
        <Select name="status" defaultValue={status ?? ''} aria-label="Status">
          <option value="active">Not closed</option>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}
            </option>
          ))}
        </Select>
        <Select name="severity" defaultValue={f.severity ?? ''} aria-label="Severity">
          <option value="">Any severity</option>
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={f.source ?? ''} aria-label="Source">
          <option value="">Any source</option>
          <option value="PM_CHECKLIST">From PM checklist</option>
          <option value="MANUAL">Reported on site</option>
        </Select>
        <div className="flex gap-2">
          {f.site ? <input type="hidden" name="site" value={f.site} /> : null}
          {f.visit ? <input type="hidden" name="visit" value={f.visit} /> : null}
          <Button type="submit">Apply</Button>
          <Link href="/failures" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Number</TableHead>
            <TableHead>Failure</TableHead>
            <TableHead>Site</TableHead>
            <TableHead>Area</TableHead>
            <TableHead>Detected</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.length === 0 ? (
            <EmptyRow colSpan={8} message="No failures match these filters." />
          ) : (
            page.items.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="whitespace-nowrap font-medium">
                  <Link href={`/failures/${x.id}`} className="hover:underline">
                    {x.number}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/failures/${x.id}`} className="hover:underline">
                    {x.title}
                  </Link>
                  {!x.stillReported ? (
                    <Badge tone="neutral" className="ml-2">
                      No longer reported
                    </Badge>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{x.source === 'MANUAL' ? `Reported by ${x.reportedBy?.fullName ?? '—'}` : 'From PM checklist'}</p>
                </TableCell>
                <TableCell className="whitespace-nowrap">{x.site.siteCode}</TableCell>
                <TableCell>{x.category ? (PM_CATEGORY_LABELS[x.category as keyof typeof PM_CATEGORY_LABELS] ?? x.category) : '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(x.detectedAt)}</TableCell>
                <TableCell>
                  <StatusBadge status={x.severity} tone={SEVERITY_TONE[x.severity]} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={x.status} tone={FAILURE_STATUS_TONE[x.status]} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{x._count?.actions ?? 0}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/failures" searchParams={sp} page={p.page} pageSize={p.pageSize} total={page.total} />
    </div>
  );
}

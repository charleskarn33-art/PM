import { humanizeStatus, PM_STATUS_TONE, type Enums } from '@ipt/shared';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyRow } from '@/components/empty-row';
import { Pagination } from '@/components/data-table/pagination';
import { SortHeader } from '@/components/data-table/sort-header';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { pageRange, parseTableParams, toIlikePattern, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'PM Visits & Review' };

const SORTS = ['submitted_at', 'started_at', 'site_code', 'technician_name', 'completion_pct', 'failure_count', 'status'] as const;
const STATUSES: Enums<'pm_status'>[] = ['SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED', 'CANCELLED'];
const when = (v: string | null) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default async function VisitsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  await requireRole(['super_admin', 'regional_manager', 'regional_supervisor', 'viewer']);
  const params = parseTableParams(sp, { sortable: SORTS, defaultSort: 'submitted_at', defaultDir: 'desc', filters: ['status', 'from', 'to'] });
  const f = params.filters;
  const status = (f.status ?? 'SUBMITTED') as Enums<'pm_status'> | 'ALL';
  const supabase = await createClient();

  let query = supabase.from('pm_visit_overview').select('*', { count: 'exact' });
  if (status !== 'ALL' && (STATUSES as string[]).includes(status)) query = query.eq('status', status);
  if (f.from) query = query.gte('started_at', `${f.from}T00:00:00`);
  if (f.to) query = query.lte('started_at', `${f.to}T23:59:59.999`);
  if (params.q) {
    const p = toIlikePattern(params.q);
    query = query.or(`site_code.ilike.${p},site_name.ilike.${p},technician_name.ilike.${p}`);
  }
  const { from, to } = pageRange(params.page, params.pageSize);
  const { data, count, error } = await query
    .order(params.sort, { ascending: params.dir === 'asc', nullsFirst: false })
    .range(from, to);
  if (error) throw new Error(`Unable to load PM visits: ${error.message}`);
  const rows = data ?? [];
  const sortProps = { pathname: '/visits', searchParams: sp, sort: params.sort, dir: params.dir };

  return (
    <div className="space-y-6">
      <PageHeader title="PM Visits & Review" description="Submitted PM awaiting review, and PM history." />
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-5">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={params.q} placeholder="Site ID, site name or technician" className="pl-9" aria-label="Search" />
        </div>
        <Select name="status" defaultValue={status} aria-label="Status">
          <option value="SUBMITTED">Awaiting review</option>
          <option value="ALL">All statuses</option>
          {STATUSES.filter((s) => s !== 'SUBMITTED').map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={f.from} aria-label="Started from" />
        <Input type="date" name="to" defaultValue={f.to} aria-label="Started to" />
        <div className="flex gap-2 md:col-span-5">
          <Button type="submit">Apply</Button>
          <Link href="/visits" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Site" column="site_code" {...sortProps} />
            <SortHeader label="Technician" column="technician_name" {...sortProps} />
            <SortHeader label="Started" column="started_at" {...sortProps} />
            <SortHeader label="Submitted" column="submitted_at" {...sortProps} />
            <SortHeader label="Completion" column="completion_pct" {...sortProps} />
            <SortHeader label="Failures" column="failure_count" {...sortProps} />
            <SortHeader label="Status" column="status" {...sortProps} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} message={status === 'SUBMITTED' ? 'No PM is waiting for review.' : 'No PM visits match these filters.'} />
          ) : (
            rows.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/visits/${v.id}`} className="font-medium hover:underline">
                    {v.site_code} · {v.site_name}
                  </Link>
                  {v.is_demo ? <Badge className="ml-2">Demo</Badge> : null}
                </TableCell>
                <TableCell>{v.technician_name}</TableCell>
                <TableCell className="whitespace-nowrap">{when(v.started_at)}</TableCell>
                <TableCell className="whitespace-nowrap">{when(v.submitted_at)}</TableCell>
                <TableCell>{v.completion_pct}%</TableCell>
                <TableCell>
                  <Badge tone={v.failure_count ? 'danger' : 'neutral'}>{v.failure_count ?? 0}</Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={v.status!} tone={PM_STATUS_TONE[v.status!]} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/visits" searchParams={sp} page={params.page} pageSize={params.pageSize} total={count ?? 0} />
    </div>
  );
}

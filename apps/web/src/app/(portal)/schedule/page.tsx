import { can, humanizeStatus, PM_STATUS_TONE, type Enums } from '@ipt/shared';
import { Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyRow } from '@/components/empty-row';
import { Pagination } from '@/components/data-table/pagination';
import { SortHeader } from '@/components/data-table/sort-header';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { loadRegions } from '@/lib/org-data';
import { createClient } from '@/lib/supabase/server';
import { isBeyondLastPage, pageRange, parseTableParams, tableHref, toIlikePattern, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'PM Schedule' };

const SORTS = ['due_date', 'scheduled_date', 'site_code', 'technician_name', 'status', 'priority'] as const;
const STATUSES: Enums<'pm_status'>[] = ['SCHEDULED', 'OVERDUE', 'IN_PROGRESS', 'COMPLETED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'];
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export default async function SchedulePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireRole(['super_admin', 'regional_manager', 'regional_supervisor', 'viewer']);
  const params = parseTableParams(sp, {
    sortable: SORTS,
    defaultSort: 'due_date',
    filters: ['status', 'region', 'due_from', 'due_to', 'overdue', 'created'],
  });
  const f = params.filters;
  const supabase = await createClient();

  let query = supabase.from('pm_schedule_overview').select('*', { count: 'exact' });
  if (f.status && (STATUSES as string[]).includes(f.status)) query = query.eq('status', f.status as Enums<'pm_status'>);
  else if (!f.status) query = query.neq('status', 'CANCELLED');
  if (f.overdue === '1') query = query.eq('is_overdue', true);
  if (f.region) query = query.eq('region_id', f.region);
  if (f.due_from) query = query.gte('due_date', f.due_from);
  if (f.due_to) query = query.lte('due_date', f.due_to);
  if (params.q) {
    const p = toIlikePattern(params.q);
    query = query.or(`site_code.ilike.${p},site_name.ilike.${p},technician_name.ilike.${p}`);
  }
  const { from, to } = pageRange(params.page, params.pageSize);
  const [{ data, count, error }, regions] = await Promise.all([
    query.order(params.sort, { ascending: params.dir === 'asc', nullsFirst: false }).order('site_code').range(from, to),
    loadRegions(supabase),
  ]);
  if (isBeyondLastPage(error)) redirect(tableHref('/schedule', sp, { page: null }));
  if (error) throw new Error(`Unable to load PM schedule: ${error.message}`);
  const rows = data ?? [];
  const sortProps = { pathname: '/schedule', searchParams: sp, sort: params.sort, dir: params.dir };

  return (
    <div className="space-y-6">
      <PageHeader
        title="PM Schedule"
        description="Planned preventive maintenance by site and technician."
        actions={
          can(session.role, 'schedule_pm') ? (
            <Link href="/schedule/new" className={buttonVariants({ variant: 'accent' })}>
              <Plus aria-hidden />
              Schedule PM
            </Link>
          ) : null
        }
      />
      {f.created ? <Alert tone="success">{f.created} PM schedule(s) created.</Alert> : null}
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-3 xl:grid-cols-6">
        <div className="relative md:col-span-3 xl:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={params.q} placeholder="Site ID, site name or technician" className="pl-9" aria-label="Search" />
        </div>
        <Select name="status" defaultValue={f.status ?? ''} aria-label="Status">
          <option value="">All open & closed (excl. cancelled)</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </Select>
        <Select name="region" defaultValue={f.region ?? ''} aria-label="Region">
          <option value="">All regions</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Input type="date" name="due_from" defaultValue={f.due_from} aria-label="Due from" />
        <Input type="date" name="due_to" defaultValue={f.due_to} aria-label="Due to" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="overdue" value="1" defaultChecked={f.overdue === '1'} className="size-4" />
          Overdue only
        </label>
        <div className="flex gap-2 md:col-span-2 xl:col-span-5">
          <Button type="submit">Apply</Button>
          <Link href="/schedule" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Site" column="site_code" {...sortProps} />
            <SortHeader label="Technician" column="technician_name" {...sortProps} />
            <TableHead>Frequency</TableHead>
            <SortHeader label="Scheduled" column="scheduled_date" {...sortProps} />
            <SortHeader label="Due" column="due_date" {...sortProps} />
            <SortHeader label="Status" column="status" {...sortProps} />
            <SortHeader label="Priority" column="priority" {...sortProps} />
            <TableHead>Template</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={8} message="No PM schedules match these filters." />
          ) : (
            rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/schedule/${s.id}`} className="font-medium hover:underline">
                    {s.site_code} · {s.site_name}
                  </Link>
                  {s.is_demo ? <Badge className="ml-2">Demo</Badge> : null}
                </TableCell>
                <TableCell>{s.technician_name ?? <span className="text-warning">Unassigned</span>}</TableCell>
                <TableCell>{humanizeStatus(s.frequency ?? '')}</TableCell>
                <TableCell className="whitespace-nowrap">{date(s.scheduled_date)}</TableCell>
                <TableCell className="whitespace-nowrap">{date(s.due_date)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {s.is_overdue && s.status !== 'OVERDUE' ? (
                    <span className="flex gap-1">
                      <StatusBadge status={s.status!} tone={PM_STATUS_TONE[s.status!]} />
                      <StatusBadge status="OVERDUE" tone="danger" />
                    </span>
                  ) : (
                    <StatusBadge status={s.status!} tone={PM_STATUS_TONE[s.status!]} />
                  )}
                </TableCell>
                <TableCell>
                  <Badge tone={s.priority === 'CRITICAL' || s.priority === 'HIGH' ? 'danger' : 'neutral'}>{humanizeStatus(s.priority ?? '')}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">v{s.template_version}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/schedule" searchParams={sp} page={params.page} pageSize={params.pageSize} total={count ?? 0} />
    </div>
  );
}

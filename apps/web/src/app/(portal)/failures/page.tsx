import { can, FAILURE_STATUS_TONE, humanizeStatus, PM_CATEGORIES, PM_CATEGORY_LABELS, SEVERITIES, SEVERITY_TONE, type Enums } from '@ipt/shared';
import { Plus, Search } from 'lucide-react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { pageRange, parseTableParams, toIlikePattern, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Failures' };

const SORTS = ['detected_at', 'failure_number', 'site_code', 'severity', 'status', 'category'] as const;
const STATUSES: Enums<'failure_status'>[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED'];
const ACTIVE: Enums<'failure_status'>[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];
const when = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—');

export default async function FailuresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireRole(['super_admin', 'regional_manager', 'regional_supervisor', 'viewer']);
  const params = parseTableParams(sp, {
    sortable: SORTS,
    defaultSort: 'detected_at',
    defaultDir: 'desc',
    filters: ['status', 'severity', 'category', 'source', 'from', 'to'],
  });
  const f = params.filters;
  const status = f.status ?? 'ACTIVE';
  const supabase = await createClient();

  let query = supabase.from('failure_overview').select('*', { count: 'exact' });
  if (status === 'ACTIVE') query = query.in('status', ACTIVE);
  else if ((STATUSES as string[]).includes(status)) query = query.eq('status', status as Enums<'failure_status'>);
  if (f.severity && (SEVERITIES as string[]).includes(f.severity)) query = query.eq('severity', f.severity as Enums<'severity_level'>);
  if (f.category && (PM_CATEGORIES as string[]).includes(f.category)) query = query.eq('category', f.category as Enums<'pm_category'>);
  if (f.source === 'PM_CHECKLIST' || f.source === 'MANUAL') query = query.eq('source', f.source);
  if (f.from) query = query.gte('detected_at', `${f.from}T00:00:00`);
  if (f.to) query = query.lte('detected_at', `${f.to}T23:59:59.999`);
  if (params.q) {
    const p = toIlikePattern(params.q);
    query = query.or(`failure_number.ilike.${p},site_code.ilike.${p},site_name.ilike.${p},description.ilike.${p}`);
  }
  const { from, to } = pageRange(params.page, params.pageSize);
  const { data, count, error } = await query.order(params.sort, { ascending: params.dir === 'asc', nullsFirst: false }).range(from, to);
  if (error) throw new Error(`Unable to load failures: ${error.message}`);
  const rows = data ?? [];
  const sortProps = { pathname: '/failures', searchParams: sp, sort: params.sort, dir: params.dir };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Failures"
        description="Failures recorded in submitted PMs and reported manually, with their corrective-action progress."
        actions={
          can(session.role, 'manage_corrective_actions') ? (
            <Link href="/failures/new" className={buttonVariants()}>
              <Plus aria-hidden />
              Report failure
            </Link>
          ) : null
        }
      />
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={params.q} placeholder="Failure no., site or description" className="pl-9" aria-label="Search" />
        </div>
        <Select name="status" defaultValue={status} aria-label="Status">
          <option value="ACTIVE">Not yet verified</option>
          <option value="ALL">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </Select>
        <Select name="severity" defaultValue={f.severity ?? ''} aria-label="Severity">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </Select>
        <Select name="category" defaultValue={f.category ?? ''} aria-label="Category">
          <option value="">All sections</option>
          {PM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {PM_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={f.source ?? ''} aria-label="Source">
          <option value="">PM and manual</option>
          <option value="PM_CHECKLIST">From PM checklist</option>
          <option value="MANUAL">Reported manually</option>
        </Select>
        <Input type="date" name="from" defaultValue={f.from} aria-label="Detected from" />
        <Input type="date" name="to" defaultValue={f.to} aria-label="Detected to" />
        <div className="flex gap-2 md:col-span-4">
          <Button type="submit">Apply</Button>
          <Link href="/failures" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Failure" column="failure_number" {...sortProps} />
            <SortHeader label="Site" column="site_code" {...sortProps} />
            <SortHeader label="Section" column="category" {...sortProps} />
            <TableHead>Description</TableHead>
            <SortHeader label="Severity" column="severity" {...sortProps} />
            <SortHeader label="Status" column="status" {...sortProps} />
            <SortHeader label="Detected" column="detected_at" {...sortProps} />
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={8} message="No failures match these filters." />
          ) : (
            rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/failures/${r.id}`} className="font-medium hover:underline">
                    {r.failure_number}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.site_code} · {r.site_name}
                  {r.is_demo ? <Badge className="ml-2">Demo</Badge> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">{PM_CATEGORY_LABELS[r.category!]}</TableCell>
                <TableCell className="max-w-md truncate" title={r.description ?? ''}>
                  {r.description}
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.severity!} tone={SEVERITY_TONE[r.severity!]} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status!} tone={FAILURE_STATUS_TONE[r.status!]} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{when(r.detected_at)}</TableCell>
                <TableCell>
                  {r.action_count ? (
                    <span className="text-sm">
                      {r.open_action_count} open / {r.action_count}
                    </span>
                  ) : (
                    <Badge tone="warning">None</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/failures" searchParams={sp} page={params.page} pageSize={params.pageSize} total={count ?? 0} />
    </div>
  );
}

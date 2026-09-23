import { CORRECTIVE_ACTION_STATUS_TONE, humanizeStatus, PM_CATEGORY_LABELS, PRIORITIES, SEVERITY_TONE, type Enums } from '@ipt/shared';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { pageRange, parseTableParams, toIlikePattern, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Corrective Actions' };

const SORTS = ['due_date', 'created_at', 'action_number', 'site_code', 'priority', 'status', 'assignee_name'] as const;
const STATUSES: Enums<'corrective_action_status'>[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];
const ACTIVE: Enums<'corrective_action_status'>[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

export default async function CorrectiveActionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const params = parseTableParams(sp, { sortable: SORTS, defaultSort: 'due_date', defaultDir: 'asc', filters: ['status', 'priority', 'overdue', 'mine'] });
  const f = params.filters;
  const status = f.status ?? 'ACTIVE';
  const supabase = await createClient();

  let query = supabase.from('corrective_action_overview').select('*', { count: 'exact' });
  if (status === 'ACTIVE') query = query.in('status', ACTIVE);
  else if (status === 'REVIEW') query = query.eq('status', 'COMPLETED');
  else if ((STATUSES as string[]).includes(status)) query = query.eq('status', status as Enums<'corrective_action_status'>);
  if (f.priority && (PRIORITIES as string[]).includes(f.priority)) query = query.eq('priority', f.priority as Enums<'priority_level'>);
  if (f.overdue === '1') query = query.eq('is_overdue', true);
  if (f.mine === '1') query = query.eq('assigned_to', session.userId);
  if (params.q) {
    const p = toIlikePattern(params.q);
    query = query.or(`action_number.ilike.${p},site_code.ilike.${p},site_name.ilike.${p},description.ilike.${p},assignee_name.ilike.${p},failure_number.ilike.${p}`);
  }
  const { from, to } = pageRange(params.page, params.pageSize);
  const { data, count, error } = await query.order(params.sort, { ascending: params.dir === 'asc', nullsFirst: false }).range(from, to);
  if (error) throw new Error(`Unable to load corrective actions: ${error.message}`);
  const rows = data ?? [];
  const sortProps = { pathname: '/corrective-actions', searchParams: sp, sort: params.sort, dir: params.dir };

  return (
    <div className="space-y-6">
      <PageHeader title="Corrective Actions" description="Repair work raised from failures: assignment, progress, verification and closure." />
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={params.q} placeholder="Action or failure no., site, description, assignee" className="pl-9" aria-label="Search" />
        </div>
        <Select name="status" defaultValue={status} aria-label="Status">
          <option value="ACTIVE">Open (not yet verified)</option>
          <option value="REVIEW">Completed, awaiting verification</option>
          <option value="ALL">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </Select>
        <Select name="priority" defaultValue={f.priority ?? ''} aria-label="Priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {humanizeStatus(p)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="overdue" value="1" defaultChecked={f.overdue === '1'} className="size-4" />
          Overdue only
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={f.mine === '1'} className="size-4" />
          Assigned to me
        </label>
        <div className="flex gap-2 md:col-span-4">
          <Button type="submit">Apply</Button>
          <Link href="/corrective-actions" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Action" column="action_number" {...sortProps} />
            <SortHeader label="Site" column="site_code" {...sortProps} />
            <TableHead>Work</TableHead>
            <SortHeader label="Assignee" column="assignee_name" {...sortProps} />
            <SortHeader label="Priority" column="priority" {...sortProps} />
            <SortHeader label="Due" column="due_date" {...sortProps} />
            <SortHeader label="Status" column="status" {...sortProps} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} message="No corrective actions match these filters." />
          ) : (
            rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">
                  <Link href={`/corrective-actions/${r.id}`} className="font-medium hover:underline">
                    {r.action_number}
                  </Link>
                  {r.failure_number ? <span className="block text-xs text-muted-foreground">{r.failure_number}</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.site_code} · {r.site_name}
                  {r.is_demo ? <Badge className="ml-2">Demo</Badge> : null}
                </TableCell>
                <TableCell className="max-w-md">
                  <span className="line-clamp-2" title={r.description ?? ''}>
                    {r.description}
                  </span>
                  <span className="text-xs text-muted-foreground">{PM_CATEGORY_LABELS[r.category!]}</span>
                </TableCell>
                <TableCell>{r.assignee_name ?? <Badge tone="warning">Unassigned</Badge>}</TableCell>
                <TableCell>
                  <StatusBadge status={r.priority!} tone={SEVERITY_TONE[r.priority!]} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.due_date ?? '—'}
                  {r.is_overdue ? <Badge tone="danger" className="ml-2">Overdue</Badge> : null}
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status!} tone={CORRECTIVE_ACTION_STATUS_TONE[r.status!]} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/corrective-actions" searchParams={sp} page={params.page} pageSize={params.pageSize} total={count ?? 0} />
    </div>
  );
}

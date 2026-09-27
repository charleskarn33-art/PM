import { CORRECTIVE_ACTION_STATUS_TONE, SEVERITY_TONE } from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination } from '@/components/data-table/pagination';
import { EmptyRow } from '@/components/empty-row';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { loadPage, qs } from '@/lib/api/data';
import type { ActionSummary } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { dueText, formatDate } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Corrective Actions' };

const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'] as const;
const WORKING = ['ASSIGNED', 'IN_PROGRESS'];

export default async function ActionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requirePermission('corrective_actions.read');
  const p = parseTableParams(sp, { sortable: ['due'] as const, defaultSort: 'due', filters: ['status', 'mine', 'overdue', 'site'] });
  const f = p.filters;
  // Field staff see their own work first; everyone else sees all in scope.
  const mineDefault = !hasPermission(session, 'corrective_actions.manage') && hasPermission(session, 'corrective_actions.work');
  const mine = f.mine ? f.mine === 'true' : mineDefault;
  const status = f.status ?? (sp.status === undefined ? 'active' : undefined);
  const page = await loadPage<ActionSummary>(
    `/corrective-actions${qs({ status, assignedTo: mine ? 'me' : undefined, overdue: f.overdue === 'true' ? 'true' : undefined, siteId: f.site, page: p.page, pageSize: p.pageSize })}`,
  );
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <PageHeader title="Corrective Actions" description="Work to resolve failures: assigned → in progress → completed → verified → closed. New actions are created from a failure." />
      <form method="get" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-4">
        <Select name="status" defaultValue={status ?? ''} aria-label="Status">
          <option value="active">Open (not verified)</option>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}
            </option>
          ))}
        </Select>
        <Select name="mine" defaultValue={mine ? 'true' : 'false'} aria-label="Assigned to">
          <option value="false">Anyone</option>
          <option value="true">Assigned to me</option>
        </Select>
        <Select name="overdue" defaultValue={f.overdue ?? ''} aria-label="Due">
          <option value="">Any due date</option>
          <option value="true">Overdue only</option>
        </Select>
        <div className="flex gap-2">
          {f.site ? <input type="hidden" name="site" value={f.site} /> : null}
          <Button type="submit">Apply</Button>
          <Link href="/corrective-actions" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Number</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Failure</TableHead>
            <TableHead>Site</TableHead>
            <TableHead>Assigned to</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.length === 0 ? (
            <EmptyRow colSpan={8} message="No corrective actions match these filters." />
          ) : (
            page.items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap font-medium">
                  <Link href={`/corrective-actions/${a.id}`} className="hover:underline">
                    {a.number}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/corrective-actions/${a.id}`} className="hover:underline">
                    {a.title}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">
                  <Link href={`/failures/${a.failure.id}`} className="hover:underline">
                    {a.failure.number}
                  </Link>{' '}
                  <StatusBadge status={a.failure.severity} tone={SEVERITY_TONE[a.failure.severity]} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{a.site.siteCode}</TableCell>
                <TableCell>{a.assignedTo?.fullName ?? <span className="text-muted-foreground">Not assigned</span>}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {a.dueDate ? formatDate(a.dueDate) : '—'}
                  {a.dueDate && WORKING.includes(a.status) ? <p className={`text-xs ${a.dueDate < today ? 'text-danger' : 'text-muted-foreground'}`}>{dueText(a.dueDate, today)}</p> : null}
                </TableCell>
                <TableCell>
                  <StatusBadge status={a.priority} tone={SEVERITY_TONE[a.priority]} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={a.status} tone={CORRECTIVE_ACTION_STATUS_TONE[a.status]} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/corrective-actions" searchParams={sp} page={p.page} pageSize={p.pageSize} total={page.total} />
    </div>
  );
}

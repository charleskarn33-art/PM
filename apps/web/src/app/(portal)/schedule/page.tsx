import { PM_STATUS_TONE, SEVERITY_TONE } from '@ipt/shared';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination } from '@/components/data-table/pagination';
import { EmptyRow } from '@/components/empty-row';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { loadAll, loadPage, qs } from '@/lib/api/data';
import type { Schedule, UserSummary } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { dueText, formatDate } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'PM Schedule' };

const STATUSES = ['SCHEDULED', 'OVERDUE', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
const OPEN = ['SCHEDULED', 'OVERDUE', 'IN_PROGRESS', 'REJECTED'];

export default async function SchedulePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requirePermission('pm_schedules.read');
  const p = parseTableParams(sp, { sortable: ['due'] as const, defaultSort: 'due', filters: ['status', 'technician', 'site', 'from', 'to'] });
  const f = p.filters;
  const [page, technicians] = await Promise.all([
    loadPage<Schedule>(`/pm-schedules${qs({ status: f.status, technicianId: f.technician, siteId: f.site, from: f.from, to: f.to, page: p.page, pageSize: p.pageSize })}`),
    hasPermission(session, 'users.read') ? loadAll<UserSummary>('/users?role=TECHNICIAN') : Promise.resolve([] as UserSummary[]),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="PM Schedule"
        description="Planned preventive maintenance in your scope, earliest due first. Overdue PMs are marked every hour."
        actions={
          hasPermission(session, 'pm_schedules.manage') ? (
            <Link href="/schedule/new" className={buttonVariants({ variant: 'accent' })}>
              <Plus aria-hidden />
              Schedule PM
            </Link>
          ) : null
        }
      />
      <form method="get" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-5 md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={f.status ?? ''}>
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}
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
          <Label htmlFor="from">Scheduled from</Label>
          <Input id="from" name="from" type="date" defaultValue={f.from ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">to</Label>
          <Input id="to" name="to" type="date" defaultValue={f.to ?? ''} />
        </div>
        <div className="flex gap-2">
          {f.site ? <input type="hidden" name="site" value={f.site} /> : null}
          <Button type="submit">Apply</Button>
          <Link href="/schedule" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Site</TableHead>
            <TableHead>Technician</TableHead>
            <TableHead>Checklist</TableHead>
            <TableHead>Scheduled</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.length === 0 ? (
            <EmptyRow colSpan={7} message="No PM matches these filters." />
          ) : (
            page.items.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">
                  <Link href={`/schedule/${s.id}`} className="hover:underline">
                    {s.site.siteCode} · {s.site.siteName}
                  </Link>
                </TableCell>
                <TableCell>{s.technician?.fullName ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                <TableCell className="text-sm">
                  {s.template.name} v{s.template.version}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(s.scheduledDate)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(s.dueDate)}
                  {OPEN.includes(s.status) ? <p className={`text-xs ${s.dueDate < today ? 'text-danger' : 'text-muted-foreground'}`}>{dueText(s.dueDate, today)}</p> : null}
                </TableCell>
                <TableCell>
                  <StatusBadge status={s.priority} tone={SEVERITY_TONE[s.priority]} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={s.status} tone={PM_STATUS_TONE[s.status]} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/schedule" searchParams={sp} page={p.page} pageSize={p.pageSize} total={page.total} />
    </div>
  );
}

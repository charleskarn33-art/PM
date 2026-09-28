import { PM_STATUS_TONE } from '@ipt/shared';
import { FileText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pagination } from '@/components/data-table/pagination';
import { EmptyRow } from '@/components/empty-row';
import { ExportLink } from '@/components/export-link';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api/client';
import { qs } from '@/lib/api/data';
import { api } from '@/lib/api/server';
import type { PmStatus } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'PM history' };

interface HistoryItem {
  id: string;
  status: PmStatus;
  startedAt: string;
  completedAt: string | null;
  dueDate: string | null;
  onTime: boolean | null;
  completionPct: number;
  failureCount: number;
  technician: { id: string; fullName: string };
  template: { name: string; version: number };
  reviewedBy: string | null;
  readings: { dcPowerKw: number | null; loadCurrentA: number | null; rectifierVoltageV: number | null; batteryVoltageV: number | null; minUnitVoltageV: number | null; fuelLevelPct: number | null; runningHours: number | null; requiresService: boolean | null };
}
interface HistoryMeta {
  total: number;
  site: { id: string; siteCode: string; siteName: string; isDemo: boolean; region: { name: string } };
  summary: Partial<Record<PmStatus, number>>;
}

const n = (v: number | null, digits = 2, unit = '') => (v == null ? '—' : `${v.toLocaleString('en-GB', { maximumFractionDigits: digits })}${unit}`);
const SUMMARY: [PmStatus, string][] = [
  ['APPROVED', 'Approved'],
  ['COMPLETED', 'Waiting for review'],
  ['REJECTED', 'Returned'],
  ['IN_PROGRESS', 'In progress'],
];

/** Every PM visit at a site, newest first, with its result and key readings. */
export default async function SiteHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const session = await requirePermission('pm_visits.read');
  const p = parseTableParams(sp, { sortable: ['started'] as const, defaultSort: 'started', filters: ['from', 'to'] });
  let res;
  try {
    res = await api<HistoryItem[]>(`/sites/${id}/pm-history${qs({ from: p.filters.from, to: p.filters.to, page: p.page, pageSize: p.pageSize })}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 422)) notFound();
    throw e;
  }
  const items = res.data;
  const meta = res.meta as unknown as HistoryMeta;
  const site = meta.site;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`PM history — ${site.siteCode} · ${site.siteName}`}
        description={
          <>
            {site.region.name} · every PM visit at this site, newest first, with the readings recorded on it.{' '}
            <Link href={`/sites/${site.id}`} className="underline">
              Back to the site
            </Link>
          </>
        }
        actions={hasPermission(session, 'reports.export') ? <ExportLink dataset="visits" query={qs({ siteId: site.id, from: p.filters.from, to: p.filters.to })} /> : null}
      />
      {site.isDemo ? <p className="text-sm text-muted-foreground">Demo site: records seeded from the Tienii 1301 reference report, not live operations.</p> : null}

      <dl className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-4 sm:grid-cols-5">
        <div>
          <dt className="text-xs text-muted-foreground">PM visits</dt>
          <dd className="text-xl font-semibold tabular-nums">{meta.total}</dd>
        </div>
        {SUMMARY.map(([s, label]) => (
          <div key={s}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{meta.summary[s] ?? 0}</dd>
          </div>
        ))}
      </dl>

      <form method="get" className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="from">Started from</Label>
          <Input id="from" name="from" type="date" defaultValue={p.filters.from ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">to</Label>
          <Input id="to" name="to" type="date" defaultValue={p.filters.to ?? ''} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          <Link href={`/sites/${site.id}/history`} className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Technician</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Checklist</TableHead>
              <TableHead className="text-right">Failures</TableHead>
              <TableHead className="text-right">DC load</TableHead>
              <TableHead className="text-right">Rectifier</TableHead>
              <TableHead className="text-right">Battery bank</TableHead>
              <TableHead className="text-right">Lowest battery</TableHead>
              <TableHead className="text-right">Fuel</TableHead>
              <TableHead className="text-right">Running hours</TableHead>
              <TableHead>Report</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length ? (
              items.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/visits/${v.id}`} className="font-medium hover:underline">
                      {formatDateTime(v.startedAt)}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{v.technician.fullName}</TableCell>
                  <TableCell>
                    <StatusBadge status={v.status === 'COMPLETED' ? 'WAITING_FOR_REVIEW' : v.status} tone={PM_STATUS_TONE[v.status]} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {v.dueDate ? formatDate(v.dueDate) : '—'}
                    {v.onTime === false ? <span className="ml-1 text-xs text-danger">late</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Math.floor(v.completionPct)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{v.failureCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(v.readings.dcPowerKw, 3, ' kW')}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(v.readings.rectifierVoltageV, 2, ' V')}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(v.readings.batteryVoltageV, 2, ' V')}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(v.readings.minUnitVoltageV, 2, ' V')}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(v.readings.fuelLevelPct, 1, '%')}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(v.readings.runningHours, 1, ' h')}</TableCell>
                  <TableCell>
                    <a href={`/files/visits/${v.id}/report.pdf`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm hover:underline">
                      <FileText className="size-4" aria-hidden />
                      PDF
                    </a>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <EmptyRow colSpan={13} message={`No PM visits at this site${p.filters.from || p.filters.to ? ' in these dates' : ''}.`} />
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination pathname={`/sites/${site.id}/history`} searchParams={sp} page={p.page} pageSize={p.pageSize} total={meta.total} />
    </div>
  );
}

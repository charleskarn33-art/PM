import { PM_STATUS_TONE } from '@ipt/shared';
import { Download, FileText, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireCapability } from '@/lib/auth';
import { parseAnalyticsParams, PRESETS } from '@/lib/analytics-params';
import { loadRegions } from '@/lib/org-data';
import { createClient } from '@/lib/supabase/server';
import { toIlikePattern } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Reports' };
const when = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—');

const LIST_EXPORTS = [
  { title: 'Sites', href: '/sites/export', list: '/sites', note: 'Site register with location, assignment, next PM and open issues.' },
  { title: 'PM visits', href: '/visits/export?status=ALL', list: '/visits', note: 'Every PM visit with status, dates, completion, failures and review.' },
  { title: 'Failures', href: '/failures/export?status=ALL', list: '/failures', note: 'Failures with section, severity, status and corrective-action counts.' },
  { title: 'Corrective actions', href: '/corrective-actions/export?status=ALL', list: '/corrective-actions', note: 'Assignments, due dates, resolution and verification.' },
];

const ANALYTICS_EXPORTS: { label: string; dataset: string; group?: string }[] = [
  { label: 'PM compliance by region', dataset: 'compliance', group: 'region' },
  { label: 'PM compliance by county', dataset: 'compliance', group: 'county' },
  { label: 'PM compliance by technician', dataset: 'compliance', group: 'technician' },
  { label: 'PM compliance by supervisor', dataset: 'compliance', group: 'supervisor' },
  { label: 'PM compliance by month', dataset: 'compliance', group: 'month' },
  { label: 'Technician performance', dataset: 'technicians' },
  { label: 'Failures by section', dataset: 'failures', group: 'category' },
  { label: 'Failures by checklist item', dataset: 'failures', group: 'item' },
  { label: 'Failures by site', dataset: 'failures', group: 'site' },
  { label: 'Latest equipment readings (DC, generator, battery, solar, earthing)', dataset: 'readings' },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  await requireCapability('view_reports');
  const p = parseAnalyticsParams(sp, new Date());
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 100) ?? '';
  const supabase = await createClient();
  let visits = supabase
    .from('pm_visit_overview')
    .select('id, site_code, site_name, technician_name, status, submitted_at, failure_count, is_demo')
    .in('status', ['SUBMITTED', 'APPROVED', 'REJECTED'])
    .gte('submitted_at', `${p.from}T00:00:00`)
    .lte('submitted_at', `${p.to}T23:59:59.999`);
  if (q) {
    const pat = toIlikePattern(q);
    visits = visits.or(`site_code.ilike.${pat},site_name.ilike.${pat},technician_name.ilike.${pat}`);
  }
  const [visitRows, regions] = await Promise.all([visits.order('submitted_at', { ascending: false }).limit(50), loadRegions(supabase)]);
  if (visitRows.error) throw new Error(`Unable to load PM visits: ${visitRows.error.message}`);
  const periodQuery = new URLSearchParams({ period: p.preset, ...(p.preset === 'custom' ? { from: p.from, to: p.to } : {}), ...(p.region ? { region: p.region } : {}) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="PM visit reports (PDF) and Excel-compatible CSV exports. Every report covers only the data you can see, and each one generated is recorded in the audit log."
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Period</span>
          <Select name="period" defaultValue={p.preset} className="w-44">
            {PRESETS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">From (custom)</span>
          <Input type="date" name="from" defaultValue={p.from} className="w-40" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">To (custom)</span>
          <Input type="date" name="to" defaultValue={p.to} className="w-40" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Region (analytics exports)</span>
          <Select name="region" defaultValue={p.region ?? ''} className="w-48">
            <option value="">All my regions</option>
            {regions.filter((r) => r.is_active).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="relative space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Find a PM</span>
          <Search className="absolute bottom-3 left-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Site or technician" className="w-56 pl-9" />
        </label>
        <Button type="submit">Apply</Button>
        <Link href="/reports" className={buttonVariants({ variant: 'ghost' })}>
          Reset
        </Link>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>PM visit reports (PDF)</CardTitle>
          <CardDescription>
            PMs submitted {p.label.toLowerCase()} ({p.from} to {p.to}), newest first; up to 50 shown — narrow the period or search to find others.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Site</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Failures</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Report</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(visitRows.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No PM was submitted in this period.
                  </TableCell>
                </TableRow>
              ) : (
                (visitRows.data ?? []).map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="whitespace-nowrap">
                      <Link href={`/visits/${v.id}`} className="font-medium hover:underline">
                        {v.site_code} · {v.site_name}
                      </Link>
                      {v.is_demo ? <Badge className="ml-2">Demo</Badge> : null}
                    </TableCell>
                    <TableCell>{v.technician_name}</TableCell>
                    <TableCell className="whitespace-nowrap">{when(v.submitted_at)}</TableCell>
                    <TableCell>{v.failure_count}</TableCell>
                    <TableCell>
                      <StatusBadge status={v.status!} tone={PM_STATUS_TONE[v.status!]} />
                    </TableCell>
                    <TableCell className="text-right">
                      <a href={`/visits/${v.id}/report`} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                        <FileText aria-hidden />
                        PDF
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Lists (CSV)</CardTitle>
            <CardDescription>Everything in the list, all statuses. To export a filtered list, filter it and use its Export CSV button.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {LIST_EXPORTS.map((e) => (
                <li key={e.title} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <Link href={e.list} className="font-medium hover:underline">
                      {e.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{e.note}</span>
                  </span>
                  <a href={e.href} className={buttonVariants({ size: 'sm', variant: 'outline' })} download>
                    <Download aria-hidden />
                    CSV
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Analytics (CSV)</CardTitle>
            <CardDescription>
              {p.label} ({p.from} to {p.to}){p.region ? ` · ${regions.find((r) => r.id === p.region)?.name ?? ''}` : ''}. The same figures as the Analytics page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {ANALYTICS_EXPORTS.map((e) => {
                const qs = new URLSearchParams(periodQuery);
                qs.set('dataset', e.dataset);
                if (e.group) qs.set('group', e.group);
                return (
                  <li key={e.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>{e.label}</span>
                    <a href={`/analytics/export?${qs.toString()}`} className={buttonVariants({ size: 'sm', variant: 'outline' })} download>
                      <Download aria-hidden />
                      CSV
                    </a>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        CSV files open directly in Excel (UTF-8 with byte-order mark). Up to 10,000 rows per export. Cells that start with =, +, - or @ are prefixed so they are never run as formulas.
      </p>
    </div>
  );
}

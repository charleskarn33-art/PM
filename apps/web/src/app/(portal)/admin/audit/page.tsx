import { ROLE_LABELS } from '@ipt/shared';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pagination } from '@/components/data-table/pagination';
import { SortHeader } from '@/components/data-table/sort-header';
import { EmptyRow } from '@/components/empty-row';
import { ExportLink } from '@/components/export-link';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { auditActionLabel, auditEntityHref, describeAuditEntry } from '@/lib/audit';
import { requireCapability } from '@/lib/auth';
import { auditListQuery } from '@/lib/list-queries';
import { createClient } from '@/lib/supabase/server';
import { isBeyondLastPage, pageRange, parseTableParams, tableHref, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Audit Log' };

const SORTS = ['created_at', 'action', 'actor_name', 'entity_type'] as const;
const when = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  await requireCapability('view_audit_log');
  const params = parseTableParams(sp, { sortable: SORTS, defaultSort: 'created_at', defaultDir: 'desc', filters: ['action', 'entity', 'from', 'to'] });
  const f = params.filters;
  const supabase = await createClient();
  const { from, to } = pageRange(params.page, params.pageSize);
  const [list, facets] = await Promise.all([
    auditListQuery(supabase, params.q, f).order(params.sort, { ascending: params.dir === 'asc' }).order('id', { ascending: false }).range(from, to),
    supabase.rpc('audit_log_facets'),
  ]);
  if (isBeyondLastPage(list.error)) redirect(tableHref('/admin/audit', sp, { page: null }));
  if (list.error) throw new Error(`Unable to load the audit log: ${list.error.message}`);
  if (facets.error) throw new Error(`Unable to load filters: ${facets.error.message}`);
  const actions = (facets.data ?? []).filter((x) => x.kind === 'action').map((x) => x.value);
  const entities = (facets.data ?? []).filter((x) => x.kind === 'entity').map((x) => x.value);
  const rows = list.data ?? [];
  const sortProps = { pathname: '/admin/audit', searchParams: sp, sort: params.sort, dir: params.dir };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Every sign-in, configuration and organisation change, PM status change, failure and corrective-action change, and report generated. Entries cannot be edited or deleted."
        actions={<ExportLink href="/admin/audit/export" searchParams={sp} />}
      />
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={params.q} placeholder="Person, email or action" className="pl-9" aria-label="Search" />
        </div>
        <Select name="action" defaultValue={f.action ?? ''} aria-label="Action">
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {auditActionLabel(a)}
            </option>
          ))}
        </Select>
        <Select name="entity" defaultValue={f.entity ?? ''} aria-label="Record type">
          <option value="">All record types</option>
          {entities.map((e) => (
            <option key={e} value={e}>
              {e.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <div className="flex min-w-0 gap-2 md:col-span-2">
          <Input type="date" name="from" defaultValue={f.from} aria-label="From" className="min-w-0" />
          <Input type="date" name="to" defaultValue={f.to} aria-label="To" className="min-w-0" />
        </div>
        <div className="flex gap-2 md:col-span-2 xl:col-span-6">
          <Button type="submit">Apply</Button>
          <Link href="/admin/audit" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="When" column="created_at" {...sortProps} />
            <SortHeader label="Who" column="actor_name" {...sortProps} />
            <SortHeader label="Action" column="action" {...sortProps} />
            <SortHeader label="Record" column="entity_type" {...sortProps} />
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={5} message="No audit entries match these filters." />
          ) : (
            rows.map((r) => {
              const href = auditEntityHref(r.entity_type, r.entity_id, r.action!);
              const summary = describeAuditEntry(r.action!, r.metadata as never);
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">{when(r.created_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.actor_name ?? <span className="text-muted-foreground">System</span>}
                    {r.actor_role ? <span className="block text-xs text-muted-foreground">{ROLE_LABELS[r.actor_role]}</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{auditActionLabel(r.action!)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {href ? (
                      <Link href={href} className="text-info hover:underline">
                        {r.entity_type?.replace(/_/g, ' ')}
                      </Link>
                    ) : (
                      (r.entity_type?.replace(/_/g, ' ') ?? '—')
                    )}
                  </TableCell>
                  <TableCell className="max-w-xl">
                    <details>
                      <summary className="cursor-pointer text-sm">{summary || <span className="text-muted-foreground">Details</span>}</summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(r.metadata, null, 2)}</pre>
                      {r.entity_id ? <p className="mt-1 text-xs text-muted-foreground">Record id: {r.entity_id}</p> : null}
                    </details>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/admin/audit" searchParams={sp} page={params.page} pageSize={params.pageSize} total={list.count ?? 0} />
    </div>
  );
}

import { Download, Search, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination } from '@/components/data-table/pagination';
import { EmptyRow } from '@/components/empty-row';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { load, qs } from '@/lib/api/data';
import { api } from '@/lib/api/server';
import { requirePermission } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';
import { ENTITY_LABEL, ENTITY_TYPES, OUTCOME_LABEL, OUTCOME_TONE, entityHref, type AuditEntry } from './shared';

export const metadata: Metadata = { title: 'Audit log' };

const FILTERS = ['action', 'outcome', 'entityType', 'entityId', 'actorId', 'from', 'to'] as const;

/** Every change made through the system, refused attempts and sign-in failures — newest first, read-only. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  await requirePermission('audit.read');
  const p = parseTableParams(sp, { sortable: ['when'] as const, defaultSort: 'when', filters: FILTERS });
  const f = p.filters;
  const filters = { q: p.q || undefined, action: f.action, outcome: f.outcome, entityType: f.entityType, entityId: f.entityId, actorId: f.actorId, from: f.from, to: f.to };
  const [res, actions] = await Promise.all([api<AuditEntry[]>(`/audit${qs({ ...filters, page: p.page, pageSize: p.pageSize })}`), load<Record<string, string>>('/audit/actions')]);
  const items = res.data;
  const total = (res.meta as { total: number }).total;
  const actionOptions = Object.entries(actions).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every change made through the system — who, when, which record, what changed — plus refused attempts, failed sign-ins and reports or exports handed out. Entries can never be changed or removed."
        actions={
          <a href={`/audit-export${qs(filters)}`} className={buttonVariants({ variant: 'outline' })} download>
            <Download aria-hidden />
            Export CSV
          </a>
        }
      />
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-3 xl:grid-cols-6 xl:items-end">
        <div className="relative md:col-span-3 xl:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={p.q} placeholder="Person, summary, record id or request id" className="pl-9" aria-label="Search the audit log" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="action">Action</Label>
          <Select id="action" name="action" defaultValue={f.action ?? ''}>
            <option value="">Any</option>
            {actionOptions.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entityType">Record type</Label>
          <Select id="entityType" name="entityType" defaultValue={f.entityType ?? ''}>
            <option value="">Any</option>
            {ENTITY_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="outcome">Outcome</Label>
          <Select id="outcome" name="outcome" defaultValue={f.outcome ?? ''}>
            <option value="">Any</option>
            <option value="SUCCESS">Done</option>
            <option value="DENIED">Refused</option>
            <option value="FAILED">Failed</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2 md:col-span-2 xl:col-span-1 xl:grid-cols-1">
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={f.from ?? ''} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={f.to ?? ''} />
          </div>
        </div>
        {f.entityId ? <input type="hidden" name="entityId" value={f.entityId} /> : null}
        {f.actorId ? <input type="hidden" name="actorId" value={f.actorId} /> : null}
        <div className="flex gap-2 md:col-span-3 xl:col-span-6">
          <Button type="submit">Apply</Button>
          <Link href="/admin/audit" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
          {f.entityId || f.actorId ? (
            <p className="self-center text-sm text-muted-foreground">
              Showing the history of {f.entityId ? `one ${ENTITY_LABEL[f.entityType ?? ''] ?? 'record'}` : 'one person'}.
            </p>
          ) : null}
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length ? (
              items.map((e) => {
                const href = entityHref(e.entityType, e.entityId);
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.occurredAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {e.actorId ? (
                        <Link href={`/admin/audit${qs({ actorId: e.actorId })}`} className="hover:underline" title="Everything this person did">
                          {e.actorName ?? e.actorEmail ?? 'Unknown user'}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{e.action === 'auth.login_failed' ? 'Not signed in' : 'System'}</span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-64">{e.summary}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {e.entityType ? (
                        <>
                          <span className="text-muted-foreground">{ENTITY_LABEL[e.entityType] ?? e.entityType}</span>{' '}
                          {href ? (
                            <Link href={href} className="hover:underline">
                              open
                            </Link>
                          ) : null}
                          {e.entityId ? (
                            <Link href={`/admin/audit${qs({ entityType: e.entityType, entityId: e.entityId })}`} className="ml-2 hover:underline" title="The history of this record">
                              history
                            </Link>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge tone={OUTCOME_TONE[e.outcome]}>{OUTCOME_LABEL[e.outcome]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/audit/${e.id}`} className="text-sm hover:underline">
                        Details
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <EmptyRow colSpan={6} message="No entries match." />
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination pathname="/admin/audit" searchParams={sp} page={p.page} pageSize={p.pageSize} total={total} />
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4" aria-hidden />
        Passwords, tokens and signatures are never recorded. Changes of your own notifications and phone registrations are not recorded.
      </p>
    </div>
  );
}

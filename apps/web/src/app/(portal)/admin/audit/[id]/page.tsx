import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { load, qs } from '@/lib/api/data';
import { requirePermission } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { ENTITY_LABEL, OUTCOME_LABEL, OUTCOME_TONE, entityHref, show, type AuditEntry } from '../shared';

export const metadata: Metadata = { title: 'Audit entry' };

/** One audit entry: who, what, the fields that changed and what was sent. */
export default async function AuditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission('audit.read');
  const e = await load<AuditEntry>(`/audit/${id}`);
  const href = entityHref(e.entityType, e.entityId);
  const changes = Object.entries(e.changes ?? {});

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={e.summary}
        description={
          <>
            {formatDateTime(e.occurredAt)} · <Link href="/admin/audit" className="underline">Back to the audit log</Link>
          </>
        }
        actions={<Badge tone={OUTCOME_TONE[e.outcome]}>{OUTCOME_LABEL[e.outcome]}</Badge>}
      />
      <Card>
        <CardContent className="grid gap-x-8 gap-y-3 pt-6 text-sm sm:grid-cols-2">
          <Field label="Who">
            {e.actorId ? (
              <Link href={`/admin/audit${qs({ actorId: e.actorId })}`} className="hover:underline">
                {e.actorName ?? 'Unknown user'}
              </Link>
            ) : e.action === 'auth.login_failed' ? (
              'Not signed in'
            ) : (
              'System'
            )}
            {e.actorEmail ? <span className="text-muted-foreground"> · {e.actorEmail}</span> : null}
          </Field>
          <Field label="Action">
            <code className="text-xs">{e.action}</code>
          </Field>
          <Field label="Record">
            {e.entityType ? `${ENTITY_LABEL[e.entityType] ?? e.entityType} ` : '—'}
            {href ? (
              <Link href={href} className="hover:underline">
                open
              </Link>
            ) : null}
            {e.entityId ? (
              <Link href={`/admin/audit${qs({ entityType: e.entityType, entityId: e.entityId })}`} className="ml-2 hover:underline">
                history
              </Link>
            ) : null}
            {e.entityId ? <span className="block break-all text-xs text-muted-foreground">{e.entityId}</span> : null}
          </Field>
          <Field label="Request">
            <code className="break-all text-xs">
              {e.method} {e.path}
            </code>
          </Field>
          <Field label="From">
            {e.ip ?? '—'}
            {e.userAgent ? <span className="block break-all text-xs text-muted-foreground">{e.userAgent}</span> : null}
          </Field>
          <Field label="Request ID">
            <code className="break-all text-xs">{e.requestId ?? '—'}</code>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What changed</CardTitle>
        </CardHeader>
        <CardContent>
          {changes.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Before</TableHead>
                    <TableHead>After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map(([field, c]) => (
                    <TableRow key={field}>
                      <TableCell className="font-medium">{field}</TableCell>
                      <TableCell className="max-w-md break-words text-muted-foreground">{show(c.from)}</TableCell>
                      <TableCell className="max-w-md break-words">{show(c.to)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {e.outcome === 'SUCCESS' ? 'No field-level comparison for this kind of action; what was sent is below.' : 'Nothing changed: the request was not carried out.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What was sent</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-4 text-xs">{e.request ? JSON.stringify(e.request, null, 2) : '—'}</pre>
          <p className="mt-2 text-xs text-muted-foreground">Passwords, tokens and signatures are not recorded; long values and lists are shortened.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}

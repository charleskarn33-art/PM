import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { EmptyRow } from '@/components/empty-row';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { load } from '@/lib/api/data';
import { requirePermission } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { NewTemplateForm, RuleForm, RuleToggle, TemplateStepButton } from './template-forms';

export const metadata: Metadata = { title: 'PM Templates' };

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  activatedAt: string | null;
  sectionCount: number;
  visitCount: number;
  scheduleCount: number;
}

const TONE = { DRAFT: 'warning', ACTIVE: 'success', RETIRED: 'neutral' } as const;

export default async function TemplatesPage() {
  await requirePermission('pm_templates.manage');
  const [templates, rules] = await Promise.all([
    load<TemplateRow[]>('/pm-templates'),
    load<{ id: string; lhsKey: string; operator: string; rhsKey: string; message: string; isActive: boolean }[]>('/pm-consistency-rules'),
  ]);
  const hasDraft = (code: string) => templates.some((t) => t.code === code && t.status === 'DRAFT');
  return (
    <div className="space-y-6">
      <PageHeader title="PM Templates" description="Checklists are versioned: edit a draft, then activate it. Visits keep the version they started on; open schedules move to the new active version." />
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Template</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Sections</TableHead>
            <TableHead className="text-right">Visits</TableHead>
            <TableHead>Activated</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.length === 0 ? (
            <EmptyRow colSpan={7} message="No templates yet." />
          ) : (
            templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link href={`/admin/templates/${t.id}`} className="font-medium hover:underline">
                    {t.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{t.code}</p>
                </TableCell>
                <TableCell>v{t.version}</TableCell>
                <TableCell>
                  <Badge tone={TONE[t.status]}>{t.status.charAt(0) + t.status.slice(1).toLowerCase()}</Badge>
                </TableCell>
                <TableCell className="text-right">{t.sectionCount}</TableCell>
                <TableCell className="text-right">{t.visitCount}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(t.activatedAt)}</TableCell>
                <TableCell className="text-right">
                  {t.status === 'ACTIVE' && !hasDraft(t.code) ? <TemplateStepButton id={t.id} step="new-version" label="New version" /> : null}
                  {t.status === 'DRAFT' ? <TemplateStepButton id={t.id} step="activate" label="Activate" variant="default" confirm="Activate this version? New PMs and open schedules will use it." /> : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New template</CardTitle>
            <CardDescription>Starts as an empty draft.</CardDescription>
          </CardHeader>
          <CardContent>
            <NewTemplateForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Consistency rules</CardTitle>
            <CardDescription>Compare two values by their analytics keys (e.g. load current ≤ rectifier capacity). A PM whose values break an active rule cannot be completed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rules.length ? (
              <ul className="divide-y text-sm">
                {rules.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <span className={r.isActive ? '' : 'text-muted-foreground line-through'}>
                      <code className="text-xs">
                        {r.lhsKey} {r.operator} {r.rhsKey}
                      </code>
                      <span className="block">{r.message}</span>
                    </span>
                    <RuleToggle id={r.id} isActive={r.isActive} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No rules.</p>
            )}
            <RuleForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

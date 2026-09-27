import { humanizeStatus } from '@ipt/shared';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import { requirePermission } from '@/lib/auth';
import { SectionForm, TemplateDetailsForm, TemplateStepButton, type ItemValues, type ReadingValues, type SectionValues } from '../template-forms';

export const metadata: Metadata = { title: 'PM Template' };

export interface TemplateDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  sections: (SectionValues & { items: Required<ItemValues>[]; readingFields: Required<ReadingValues>[] })[];
}

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission('pm_templates.manage');
  const t = await load<TemplateDetail>(`/pm-templates/${id}`);
  const draft = t.status === 'DRAFT';
  return (
    <div className="space-y-6">
      <PageHeader
        title={`${t.name} v${t.version}`}
        description={t.code}
        actions={
          <>
            <Badge tone={draft ? 'warning' : t.status === 'ACTIVE' ? 'success' : 'neutral'}>{humanizeStatus(t.status)}</Badge>
            {draft ? <TemplateStepButton id={t.id} step="activate" label="Activate" variant="default" confirm="Activate this version? New PMs and open schedules will use it." /> : null}
            {draft ? <TemplateStepButton id={t.id} step="delete" label="Delete draft" variant="destructive" confirm="Delete this draft and everything in it?" /> : null}
          </>
        }
      />
      {!draft ? <Alert tone="info">This version is {t.status.toLowerCase()} and cannot be changed. Create a new version from the templates list to change the checklist.</Alert> : null}
      {draft ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Template</CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateDetailsForm id={t.id} name={t.name} description={t.description} />
          </CardContent>
        </Card>
      ) : null}
      {t.sections.map((s) => (
        <Card key={s.id}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {s.name} <span className="text-xs font-normal text-muted-foreground">{s.code} · {humanizeStatus(s.category)}</span>
            </CardTitle>
            <span className="flex gap-2">
              {!s.isActive ? <Badge tone="neutral">Inactive</Badge> : null}
              {s.allowNotApplicable ? <Badge tone="outline">N/A allowed{s.requiresEquipment ? ` (default without ${s.requiresEquipment.toLowerCase()})` : ''}</Badge> : null}
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            {s.readingFields.length ? (
              <div>
                <p className="mb-1 text-sm font-medium">Readings</p>
                <ul className="divide-y text-sm">
                  {s.readingFields.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 py-1.5">
                      <Link href={`/admin/templates/${t.id}/readings/${f.id}`} className="hover:underline">
                        {f.label}
                        {f.unit ? ` (${f.unit})` : ''}
                      </Link>
                      <span className="flex gap-1 text-xs text-muted-foreground">
                        {f.isRequired ? <Badge tone="outline">Required</Badge> : null}
                        {!f.isActive ? <Badge tone="neutral">Inactive</Badge> : null}
                        {f.analyticsKey ? <code>{f.analyticsKey}</code> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-sm font-medium">Checklist</p>
              {s.items.length ? (
                <ul className="divide-y text-sm">
                  {s.items.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                      <Link href={`/admin/templates/${t.id}/items/${i.id}`} className="hover:underline">
                        {i.prompt}
                      </Link>
                      <span className="flex shrink-0 gap-1">
                        <Badge tone="outline">{i.responseType === 'YES_NO_NA' ? 'Yes/No/N/A' : humanizeStatus(i.responseType)}</Badge>
                        {i.failureOnAnswer ? <Badge tone="danger">Fails on {i.failureOnAnswer === 'YES' ? 'Yes' : 'No'}</Badge> : null}
                        {!i.isActive ? <Badge tone="neutral">Inactive</Badge> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No questions.</p>
              )}
            </div>
            {draft ? (
              <div className="flex flex-wrap gap-4 text-sm">
                <Link href={`/admin/templates/${t.id}/items/new?section=${s.id}`} className="inline-flex items-center gap-1 text-info hover:underline">
                  <Plus className="size-4" aria-hidden /> Add question
                </Link>
                <Link href={`/admin/templates/${t.id}/readings/new?section=${s.id}`} className="inline-flex items-center gap-1 text-info hover:underline">
                  <Plus className="size-4" aria-hidden /> Add reading
                </Link>
              </div>
            ) : null}
            {draft ? (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Edit section</summary>
                <div className="pt-3">
                  <SectionForm templateId={t.id} section={s} />
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ))}
      {draft ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add section</CardTitle>
          </CardHeader>
          <CardContent>
            <SectionForm templateId={t.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

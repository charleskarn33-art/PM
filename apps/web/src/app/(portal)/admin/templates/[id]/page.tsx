import { humanizeStatus } from '@ipt/shared';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import { activateTemplate, cloneTemplate, moveEntry } from '../actions';
import { SectionForm } from './section-form';

export const metadata: Metadata = { title: 'PM template' };

function MoveButtons({ kind, id, templateId }: { kind: 'item' | 'reading'; id: string; templateId: string }) {
  return (
    <span className="flex">
      {(['up', 'down'] as const).map((direction) => (
        <form key={direction} action={moveEntry}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="direction" value={direction} />
          <input type="hidden" name="template_id" value={templateId} />
          <Button type="submit" variant="ghost" size="sm" aria-label={`Move ${direction}`}>
            {direction === 'up' ? <ArrowUp /> : <ArrowDown />}
          </Button>
        </form>
      ))}
    </span>
  );
}

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCapability('manage_templates');
  const supabase = await createClient();
  const { data: template, error } = await supabase
    .from('pm_templates')
    .select('*, pm_sections(*, pm_checklist_items(*), pm_reading_fields(*))')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Unable to load template: ${error.message}`);
  if (!template) notFound();
  const readOnly = template.status === 'RETIRED';
  const sections = [...template.pm_sections].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${template.name} · v${template.version}`}
        description={
          <span className="flex items-center gap-2">
            <Badge tone={template.status === 'ACTIVE' ? 'success' : template.status === 'DRAFT' ? 'warning' : 'neutral'}>{template.status}</Badge>
            {template.code}
          </span>
        }
        actions={
          <>
            {template.status === 'DRAFT' ? (
              <form action={activateTemplate}>
                <input type="hidden" name="template_id" value={id} />
                <Button type="submit" variant="accent">
                  Activate this version
                </Button>
              </form>
            ) : (
              <form action={cloneTemplate}>
                <input type="hidden" name="template_id" value={id} />
                <Button type="submit" variant="outline">
                  Create new version
                </Button>
              </form>
            )}
          </>
        }
      />
      {readOnly ? <Alert tone="info">Retired version — read-only. It remains available for historical PM records.</Alert> : null}
      {template.status === 'ACTIVE' ? (
        <Alert tone="warning">
          This is the live version. Wording, severity and evidence changes apply immediately (answers keep the question text they
          were given). For structural changes that should not affect PM already in progress, create a new version.
        </Alert>
      ) : null}

      {sections.map((section) => {
        const items = [...section.pm_checklist_items].sort((a, b) => a.sort_order - b.sort_order);
        const readings = [...section.pm_reading_fields].sort((a, b) => a.sort_order - b.sort_order);
        return (
          <Card key={section.id} id={`section-${section.id}`}>
            <CardHeader className="gap-3">
              <CardTitle className="flex items-center gap-2">
                {section.name}
                <Badge tone="outline">{humanizeStatus(section.category)}</Badge>
                {section.is_active ? null : <Badge>Inactive</Badge>}
              </CardTitle>
              {readOnly ? null : <SectionForm templateId={id} section={section} />}
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Readings</h3>
                  {readOnly ? null : (
                    <Link href={`/admin/templates/${id}/readings/new?section=${section.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                      <Plus /> Add reading
                    </Link>
                  )}
                </div>
                {readings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No readings.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {readings.map((f) => (
                      <li key={f.id} className={cn('flex items-center justify-between gap-3 px-3 py-2 text-sm', !f.is_active && 'opacity-50')}>
                        <Link href={`/admin/templates/${id}/readings/${f.id}`} className="hover:underline">
                          {f.label}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {humanizeStatus(f.value_type)}
                            {f.unit ? ` · ${f.unit}` : ''}
                            {f.min_value != null || f.max_value != null ? ` · ${f.min_value ?? '−∞'}–${f.max_value ?? '∞'}` : ''}
                            {f.is_required ? '' : ' · optional'}
                          </span>
                        </Link>
                        {readOnly ? null : <MoveButtons kind="reading" id={f.id} templateId={id} />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Checklist ({items.filter((i) => i.is_active).length} active)</h3>
                  {readOnly ? null : (
                    <Link href={`/admin/templates/${id}/items/new?section=${section.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                      <Plus /> Add question
                    </Link>
                  )}
                </div>
                <ul className="divide-y rounded-lg border">
                  {items.map((item) => (
                    <li key={item.id} className={cn('flex items-center justify-between gap-3 px-3 py-2 text-sm', !item.is_active && 'opacity-50')}>
                      <Link href={`/admin/templates/${id}/items/${item.id}`} className="min-w-0 hover:underline">
                        {item.prompt}
                        <span className="ml-2 flex-wrap text-xs text-muted-foreground">
                          {humanizeStatus(item.response_type)}
                          {item.is_required ? '' : ' · optional'}
                        </span>
                      </Link>
                      <span className="flex shrink-0 items-center gap-1">
                        {item.creates_failure_on_no || item.creates_failure_on_yes ? (
                          <Badge tone="danger">
                            Fails on {item.creates_failure_on_no ? 'NO' : 'YES'} · {item.failure_severity}
                          </Badge>
                        ) : null}
                        {item.requires_photo_on_answer.length ? <Badge tone="info">Photo on {item.requires_photo_on_answer.join('/')}</Badge> : null}
                        {item.is_active ? null : <Badge>Inactive</Badge>}
                        {readOnly ? null : <MoveButtons kind="item" id={item.id} templateId={id} />}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

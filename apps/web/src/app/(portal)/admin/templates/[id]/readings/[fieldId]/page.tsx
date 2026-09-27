import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import { requirePermission } from '@/lib/auth';
import { ReadingFieldForm } from '../../../template-forms';
import type { TemplateDetail } from '../../page';

export const metadata: Metadata = { title: 'Reading' };

export default async function ReadingPage({ params, searchParams }: { params: Promise<{ id: string; fieldId: string }>; searchParams: Promise<{ section?: string }> }) {
  const { id, fieldId } = await params;
  const { section: sectionParam } = await searchParams;
  await requirePermission('pm_templates.manage');
  const t = await load<TemplateDetail>(`/pm-templates/${id}`);
  const section = fieldId === 'new' ? t.sections.find((s) => s.id === sectionParam) : t.sections.find((s) => s.readingFields.some((f) => f.id === fieldId));
  const field = section?.readingFields.find((f) => f.id === fieldId);
  if (!section || (fieldId !== 'new' && !field)) notFound();
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={field ? 'Reading' : 'New reading'} description={`${t.name} v${t.version} · ${section.name}`} />
      <Card>
        <CardContent className="pt-6">
          <ReadingFieldForm templateId={t.id} sectionId={section.id} field={field} editable={t.status === 'DRAFT'} />
        </CardContent>
      </Card>
    </div>
  );
}

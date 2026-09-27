import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import { requirePermission } from '@/lib/auth';
import { ItemForm } from '../../../template-forms';
import type { TemplateDetail } from '../../page';

export const metadata: Metadata = { title: 'Checklist question' };

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string; itemId: string }>; searchParams: Promise<{ section?: string }> }) {
  const { id, itemId } = await params;
  const { section: sectionParam } = await searchParams;
  await requirePermission('pm_templates.manage');
  const t = await load<TemplateDetail>(`/pm-templates/${id}`);
  const section = itemId === 'new' ? t.sections.find((s) => s.id === sectionParam) : t.sections.find((s) => s.items.some((i) => i.id === itemId));
  const item = section?.items.find((i) => i.id === itemId);
  if (!section || (itemId !== 'new' && !item)) notFound();
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={item ? 'Question' : 'New question'} description={`${t.name} v${t.version} · ${section.name}`} />
      <Card>
        <CardContent className="pt-6">
          <ItemForm templateId={t.id} sectionId={section.id} item={item} editable={t.status === 'DRAFT'} />
        </CardContent>
      </Card>
    </div>
  );
}

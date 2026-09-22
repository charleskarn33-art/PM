import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ItemForm } from '../../item-form';

export const metadata: Metadata = { title: 'Checklist question' };

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; itemId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const [{ id, itemId }, { section }] = await Promise.all([params, searchParams]);
  await requireCapability('manage_templates');
  const supabase = await createClient();
  const { data: template, error } = await supabase.from('pm_templates').select('status, name, version').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!template) notFound();

  let item = undefined;
  let sectionId = section ?? '';
  if (itemId !== 'new') {
    const res = await supabase.from('pm_checklist_items').select('*').eq('id', itemId).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    if (!res.data) notFound();
    item = res.data;
    sectionId = res.data.section_id;
  }
  const { data: sec } = await supabase.from('pm_sections').select('name, template_id').eq('id', sectionId).maybeSingle();
  if (!sec || sec.template_id !== id) notFound();

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={item ? 'Edit question' : 'Add question'} description={`${template.name} v${template.version} · ${sec.name}`} />
      <Card>
        <CardContent className="pt-5">
          <ItemForm templateId={id} sectionId={sectionId} item={item} readOnly={template.status === 'RETIRED'} />
        </CardContent>
      </Card>
    </div>
  );
}

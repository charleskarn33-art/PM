import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ReadingForm } from '../../reading-form';

export const metadata: Metadata = { title: 'Reading' };

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; fieldId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const [{ id, fieldId }, { section }] = await Promise.all([params, searchParams]);
  await requireCapability('manage_templates');
  const supabase = await createClient();
  const { data: template, error } = await supabase.from('pm_templates').select('status, name, version').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!template) notFound();

  let field = undefined;
  let sectionId = section ?? '';
  if (fieldId !== 'new') {
    const res = await supabase.from('pm_reading_fields').select('*').eq('id', fieldId).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    if (!res.data) notFound();
    field = res.data;
    sectionId = res.data.section_id;
  }
  const { data: sec } = await supabase.from('pm_sections').select('name, template_id').eq('id', sectionId).maybeSingle();
  if (!sec || sec.template_id !== id) notFound();

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={field ? 'Edit reading' : 'Add reading'} description={`${template.name} v${template.version} · ${sec.name}`} />
      <Card>
        <CardContent className="pt-5">
          <ReadingForm templateId={id} sectionId={sectionId} field={field} readOnly={template.status === 'RETIRED'} />
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { loadClusters, loadCounties, loadRegions, loadSupervisors } from '@/lib/org-data';
import { createClient } from '@/lib/supabase/server';
import { SiteForm } from '../../site-form';

export const metadata: Metadata = { title: 'Edit site' };

export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCapability('manage_organization');
  const supabase = await createClient();
  const [siteResult, regions, clusters, counties, supervisors] = await Promise.all([
    supabase.from('sites').select('*').eq('id', id).maybeSingle(),
    loadRegions(supabase),
    loadClusters(supabase),
    loadCounties(supabase),
    loadSupervisors(supabase),
  ]);
  if (siteResult.error) throw new Error(`Unable to load site: ${siteResult.error.message}`);
  const site = siteResult.data;
  if (!site) notFound();
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={`Edit ${site.site_code} · ${site.site_name}`} />
      <Card>
        <CardContent className="pt-5">
          <SiteForm initial={site} regions={regions} clusters={clusters} counties={counties} supervisors={supervisors} />
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { loadClusters, loadCounties, loadRegions, loadSupervisors } from '@/lib/org-data';
import { createClient } from '@/lib/supabase/server';
import { SiteForm } from '../site-form';

export const metadata: Metadata = { title: 'New site' };

export default async function NewSitePage() {
  await requireCapability('manage_organization');
  const supabase = await createClient();
  const [regions, clusters, counties, supervisors] = await Promise.all([
    loadRegions(supabase),
    loadClusters(supabase),
    loadCounties(supabase),
    loadSupervisors(supabase),
  ]);
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="New site" />
      <Card>
        <CardContent className="pt-5">
          <SiteForm regions={regions} clusters={clusters} counties={counties} supervisors={supervisors} />
        </CardContent>
      </Card>
    </div>
  );
}

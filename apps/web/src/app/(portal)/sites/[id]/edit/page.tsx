import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import type { Region, Site } from '@/lib/api/types';
import { requirePermission } from '@/lib/auth';
import { SiteForm } from '../../site-form';

export const metadata: Metadata = { title: 'Edit site' };

export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePermission('sites.manage');
  if (!session.isGlobal) notFound();
  const [site, hierarchy] = await Promise.all([load<Site>(`/sites/${id}`), load<Region[]>('/org/hierarchy')]);
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={`Edit ${site.siteCode}`} description={site.siteName} />
      <Card>
        <CardContent className="pt-6">
          <SiteForm site={site} hierarchy={hierarchy} />
        </CardContent>
      </Card>
    </div>
  );
}

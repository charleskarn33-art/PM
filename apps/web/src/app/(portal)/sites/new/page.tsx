import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import type { Region } from '@/lib/api/types';
import { requirePermission } from '@/lib/auth';
import { SiteForm } from '../site-form';

export const metadata: Metadata = { title: 'New site' };

export default async function NewSitePage() {
  const session = await requirePermission('sites.manage');
  if (!session.isGlobal) notFound(); // sites are created by administrators
  const hierarchy = await load<Region[]>('/org/hierarchy');
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="New site" />
      <Card>
        <CardContent className="pt-6">
          <SiteForm hierarchy={hierarchy} />
        </CardContent>
      </Card>
    </div>
  );
}

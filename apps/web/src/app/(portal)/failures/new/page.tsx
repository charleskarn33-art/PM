import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { loadAll } from '@/lib/api/data';
import type { Site } from '@/lib/api/types';
import { requirePermission } from '@/lib/auth';
import { ReportFailureForm } from '../failure-forms';

export const metadata: Metadata = { title: 'Report failure' };

export default async function ReportFailurePage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  await requirePermission('failures.report');
  const sites = await loadAll<Site>('/sites?status=ACTIVE');
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Report failure" description="A failure found outside a PM checklist. Failed checklist answers are recorded automatically when a PM is completed." />
      <Card>
        <CardContent className="pt-6">
          <ReportFailureForm siteId={site} sites={sites.map((s) => ({ id: s.id, label: `${s.siteCode} · ${s.siteName}` }))} />
        </CardContent>
      </Card>
    </div>
  );
}

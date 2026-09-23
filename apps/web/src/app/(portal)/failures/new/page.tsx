import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ManualFailureForm } from '../failure-forms';

export const metadata: Metadata = { title: 'Report failure' };

export default async function NewFailurePage() {
  await requireCapability('manage_corrective_actions');
  const supabase = await createClient();
  const { data, error } = await supabase.from('site_overview').select('id, site_code, site_name').eq('status', 'ACTIVE').order('site_code');
  if (error) throw new Error(`Unable to load sites: ${error.message}`);
  const sites = (data ?? []).map((s) => ({ id: s.id!, label: `${s.site_code} · ${s.site_name}` }));
  return (
    <div className="space-y-6">
      <PageHeader title="Report failure" description="Record a failure found outside a PM checklist (for example during a site visit or from an alarm)." />
      <Card>
        <CardContent className="pt-6">
          <ManualFailureForm sites={sites} />
        </CardContent>
      </Card>
    </div>
  );
}

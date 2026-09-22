import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { loadRegions } from '@/lib/org-data';
import { isAdminClientConfigured } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Invite user' };

export default async function InvitePage() {
  await requireCapability('manage_users');
  const supabase = await createClient();
  const regions = (await loadRegions(supabase)).filter((r) => r.is_active);
  const configured = isAdminClientConfigured();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Invite user"
        description="The user receives an email link to set their password. The account is activated with the selected role."
      />
      {!configured ? (
        <Alert tone="warning">
          Invitations require the <code>SUPABASE_SECRET_KEY</code> server environment variable. It is not set, so
          invitations are disabled. Users can still be created in the Supabase dashboard and activated here.
        </Alert>
      ) : null}
      <Card>
        <CardContent className="pt-5">
          <InviteForm regions={regions} disabled={!configured} />
        </CardContent>
      </Card>
    </div>
  );
}

import { ROLE_LABELS } from '@ipt/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { loadRegions, loadSupervisors } from '@/lib/org-data';
import { createClient } from '@/lib/supabase/server';
import { AccessForm, SupervisorDetailsForm, TechnicianDetailsForm } from './user-forms';

export const metadata: Metadata = { title: 'User' };

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invited?: string }>;
}) {
  const [{ id }, { invited }] = await Promise.all([params, searchParams]);
  const session = await requireCapability('manage_users');
  const supabase = await createClient();

  const [profileResult, scopesResult, techResult, supResult, regions, supervisors] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
    supabase.from('user_region_scopes').select('region_id').eq('profile_id', id),
    supabase.from('technicians').select('*').eq('id', id).maybeSingle(),
    supabase.from('supervisors').select('*').eq('id', id).maybeSingle(),
    loadRegions(supabase),
    loadSupervisors(supabase),
  ]);
  for (const r of [profileResult, scopesResult, techResult, supResult]) {
    if (r.error) throw new Error(`Unable to load user: ${r.error.message}`);
  }
  const profile = profileResult.data;
  if (!profile) notFound();
  const regionOptions = regions.map((r) => ({ id: r.id, name: r.name }));
  const technician = techResult.data;
  const supervisor = supResult.data;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={profile.full_name || profile.email}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {profile.email}
            <Badge tone="info">{ROLE_LABELS[profile.role]}</Badge>
            <Badge tone={profile.is_active ? 'success' : 'warning'}>{profile.is_active ? 'Active' : 'Pending'}</Badge>
          </span>
        }
      />
      {invited ? <Alert tone="success">Invitation sent to {profile.email}.</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
          <CardDescription>Role and activation changes are recorded in the audit log.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccessForm
            userId={profile.id}
            role={profile.role}
            isActive={profile.is_active}
            regionId={profile.region_id}
            scopeRegionIds={(scopesResult.data ?? []).map((s) => s.region_id)}
            regions={regionOptions}
            isSelf={profile.id === session.userId}
          />
        </CardContent>
      </Card>

      {profile.role === 'technician' && technician ? (
        <Card>
          <CardHeader>
            <CardTitle>Technician details</CardTitle>
          </CardHeader>
          <CardContent>
            <TechnicianDetailsForm
              userId={profile.id}
              employeeCode={technician.employee_code}
              supervisorId={technician.supervisor_id}
              regionId={technician.region_id}
              supervisors={supervisors.filter((s) => s.is_active)}
              regions={regionOptions}
            />
          </CardContent>
        </Card>
      ) : null}

      {profile.role === 'regional_supervisor' && supervisor ? (
        <Card>
          <CardHeader>
            <CardTitle>Supervisor details</CardTitle>
          </CardHeader>
          <CardContent>
            <SupervisorDetailsForm userId={profile.id} employeeCode={supervisor.employee_code} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

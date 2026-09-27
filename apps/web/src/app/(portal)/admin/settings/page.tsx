import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import { requirePermission } from '@/lib/auth';
import { GeofenceForm, PmRulesForm } from './settings-forms';

export const metadata: Metadata = { title: 'Settings' };

interface Settings {
  geofence: { mode: 'WARN' | 'REQUIRE_REASON' | 'BLOCK'; radiusM: number };
  pm: { requireSignature: boolean };
}

export default async function SettingsPage() {
  await requirePermission('settings.manage');
  const s = await load<Settings>('/settings');
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="System rules applied by the API and the mobile app. Analytics thresholds come with Phase 10, notification settings with Phase 12." />
      <Card>
        <CardHeader>
          <CardTitle>PM start geofence</CardTitle>
          <CardDescription>The phone reports its position when a PM starts; the API applies this rule to it.</CardDescription>
        </CardHeader>
        <CardContent>
          <GeofenceForm mode={s.geofence.mode} radiusM={s.geofence.radiusM} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>PM completion</CardTitle>
        </CardHeader>
        <CardContent>
          <PmRulesForm requireSignature={s.pm.requireSignature} />
        </CardContent>
      </Card>
    </div>
  );
}

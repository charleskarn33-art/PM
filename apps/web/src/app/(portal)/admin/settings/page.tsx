import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import { requirePermission } from '@/lib/auth';
import { GeofenceForm, NotificationSettingsForm, PmRulesForm, ThresholdsForm } from './settings-forms';

export const metadata: Metadata = { title: 'Settings' };

interface Settings {
  geofence: { mode: 'WARN' | 'REQUIRE_REASON' | 'BLOCK'; radiusM: number };
  pm: { requireSignature: boolean };
  thresholds: Record<string, number | null>;
  notifications: { pmDueReminderDays: number | null; actionOverdueAlerts: boolean };
}

export default async function SettingsPage() {
  await requirePermission('settings.manage');
  const s = await load<Settings>('/settings');
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="System rules applied by the API and the mobile app." />
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
      <Card id="notifications">
        <CardHeader>
          <CardTitle>Notification reminders</CardTitle>
          <CardDescription>
            People are always told about what happens to their work (PM scheduled, submitted, approved or returned, critical failures, corrective actions assigned, completed or sent back, PMs overdue). These scheduled reminders are extra and off until set here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettingsForm pmDueReminderDays={s.notifications.pmDueReminderDays} actionOverdueAlerts={s.notifications.actionOverdueAlerts} />
        </CardContent>
      </Card>
      <Card id="thresholds">
        <CardHeader>
          <CardTitle>Analytics thresholds</CardTitle>
          <CardDescription>
            No engineering limit is assumed: a threshold left empty flags nothing. Set the limits your organisation uses; Analytics flags each site&apos;s latest reading against them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThresholdsForm values={s.thresholds} />
        </CardContent>
      </Card>
    </div>
  );
}

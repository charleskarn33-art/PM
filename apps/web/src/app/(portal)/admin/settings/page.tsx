import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ConsistencyRuleForm, DcThresholdsForm, GeofenceForm, PmSubmissionForm, type ValueKey } from './settings-forms';

export const metadata: Metadata = { title: 'Settings' };

interface GeofenceValue {
  radius_m: number;
  mode: string;
}
interface DcValue {
  high_load_kw: number | null;
  high_load_current_a: number | null;
}
interface SubmissionValue {
  enforce_photo_requirements: boolean;
}

export default async function SettingsPage() {
  await requireCapability('manage_settings');
  const supabase = await createClient();
  const [settings, rules, keys] = await Promise.all([
    supabase.from('system_settings').select('key, value, updated_at').in('key', ['geofence', 'dc_thresholds', 'pm_submission']),
    supabase.from('pm_consistency_rules').select('id, lhs_key, operator, rhs_key, message, is_active').order('created_at'),
    supabase.from('pm_value_keys').select('analytics_key, label, unit').order('analytics_key'),
  ]);
  const loadError = settings.error ?? rules.error ?? keys.error;
  if (loadError) throw new Error(`Unable to load settings: ${loadError.message}`);

  const byKey = new Map((settings.data ?? []).map((s) => [s.key, s.value]));
  const geofence = (byKey.get('geofence') as GeofenceValue | undefined) ?? { radius_m: 100, mode: 'WARN' };
  const dc = (byKey.get('dc_thresholds') as DcValue | undefined) ?? { high_load_kw: null, high_load_current_a: null };
  const submission = (byKey.get('pm_submission') as SubmissionValue | undefined) ?? { enforce_photo_requirements: true };
  const valueKeys: ValueKey[] = (keys.data ?? []).map((k) => ({ analytics_key: k.analytics_key!, label: k.label ?? k.analytics_key!, unit: k.unit }));
  const labelOf = new Map(valueKeys.map((k) => [k.analytics_key, k.label]));

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="System-wide PM rules. Every change is recorded in the audit log; phones pick changes up on their next sync." />

      <Card>
        <CardHeader>
          <CardTitle>GPS geofence at PM start</CardTitle>
          <CardDescription>How far from the site a technician may start a PM, and what happens when they are further away.</CardDescription>
        </CardHeader>
        <CardContent>
          <GeofenceForm initial={geofence} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PM submission</CardTitle>
          <CardDescription>Evidence photo enforcement for technicians submitting a PM.</CardDescription>
        </CardHeader>
        <CardContent>
          <PmSubmissionForm initial={submission} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>DC high-load thresholds</CardTitle>
          <CardDescription>Flags a DC reading as high load in the PM review and on the phone.</CardDescription>
        </CardHeader>
        <CardContent>
          <DcThresholdsForm initial={dc} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consistency rules</CardTitle>
          <CardDescription>
            Cross-checks between two recorded values (for example, operational modules cannot exceed installed modules). A PM that breaks an active
            rule cannot be submitted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(rules.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No rules yet.</p> : null}
          <ul className="divide-y">
            {(rules.data ?? []).map((r) => (
              <li key={r.id} className="py-2">
                <details>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">
                        {labelOf.get(r.lhs_key) ?? r.lhs_key} {r.operator} {labelOf.get(r.rhs_key) ?? r.rhs_key}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">{r.message}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {r.is_active ? null : <Badge tone="neutral">Inactive</Badge>}
                      <span className="text-xs text-info">Edit</span>
                    </span>
                  </summary>
                  <div className="mt-3 rounded-lg bg-muted/40 p-3">
                    <ConsistencyRuleForm keys={valueKeys} initial={r} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <div className="rounded-lg border p-3">
            <p className="mb-3 text-sm font-medium">Add a rule</p>
            <ConsistencyRuleForm keys={valueKeys} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

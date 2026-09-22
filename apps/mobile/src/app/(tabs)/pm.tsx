import { humanizeStatus, isPmOverdue, OPEN_PM_STATUSES, PM_STATUS_TONE, toIsoDate, type Enums } from '@ipt/shared';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, EmptyState, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { describeError, useRemoteQuery } from '@/lib/use-remote-query';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

interface Row {
  key: string;
  kind: 'schedule' | 'visit';
  siteId: string;
  siteCode: string;
  siteName: string;
  status: Enums<'pm_status'>;
  due: string | null;
  scheduleId: string | null;
  templateId: string;
  visitId: string | null;
  frequency?: string;
  completion?: number;
  review?: string | null;
}

export default function PmScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const { submitted } = useLocalSearchParams<{ submitted?: string }>();
  const userId = profile?.id;
  const isTechnician = profile?.role === 'technician';
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const query = useRemoteQuery(async (): Promise<Row[]> => {
    if (!supabase || !userId) throw new Error('Not signed in.');
    if (!isTechnician) return [];
    const [schedules, visits] = await Promise.all([
      supabase
        .from('pm_schedule_overview')
        .select('id, site_id, site_code, site_name, status, due_date, frequency, template_id, visit_id')
        .eq('technician_id', userId)
        .in('status', [...OPEN_PM_STATUSES, 'REJECTED'])
        .order('due_date'),
      supabase
        .from('pm_visit_overview')
        .select('id, site_id, site_code, site_name, status, schedule_id, template_id, completion_pct, review_comments')
        .eq('technician_id', userId)
        .in('status', ['IN_PROGRESS', 'COMPLETED', 'REJECTED'])
        .order('started_at', { ascending: false }),
    ]);
    if (schedules.error) throw new Error(schedules.error.message);
    if (visits.error) throw new Error(visits.error.message);
    const visitBySchedule = new Map((visits.data ?? []).filter((v) => v.schedule_id).map((v) => [v.schedule_id!, v]));
    const rows: Row[] = (schedules.data ?? []).map((s) => {
      const v = visitBySchedule.get(s.id!);
      return {
        key: `s-${s.id}`,
        kind: 'schedule',
        siteId: s.site_id!,
        siteCode: s.site_code!,
        siteName: s.site_name!,
        status: (v?.status ?? s.status)!,
        due: s.due_date,
        scheduleId: s.id,
        templateId: s.template_id!,
        visitId: v?.id ?? s.visit_id ?? null,
        frequency: s.frequency ?? undefined,
        completion: v?.completion_pct ?? undefined,
        review: v?.review_comments,
      };
    });
    for (const v of visits.data ?? []) {
      if (v.schedule_id && rows.some((r) => r.scheduleId === v.schedule_id)) continue;
      rows.push({
        key: `v-${v.id}`,
        kind: 'visit',
        siteId: v.site_id!,
        siteCode: v.site_code!,
        siteName: v.site_name!,
        status: v.status!,
        due: null,
        scheduleId: v.schedule_id,
        templateId: v.template_id!,
        visitId: v.id,
        completion: v.completion_pct ?? undefined,
        review: v.review_comments,
      });
    }
    return rows;
  }, `pm:${userId}:${isTechnician}:${submitted ?? ''}`);

  async function start(row: Row) {
    if (row.visitId) {
      router.push({ pathname: '/pm/[visitId]', params: { visitId: row.visitId } });
      return;
    }
    if (!supabase || !userId) return;
    setStarting(row.key);
    setStartError(null);
    // The id is generated on the device so a retried request cannot create a duplicate visit.
    const id = randomUUID();
    const { error } = await supabase.from('pm_visits').insert({
      id,
      site_id: row.siteId,
      template_id: row.templateId,
      technician_id: userId,
      schedule_id: row.scheduleId,
      status: 'IN_PROGRESS',
      client_created_at: new Date().toISOString(),
    });
    setStarting(null);
    if (error && error.code !== '23505') {
      setStartError(`Unable to start PM: ${describeError(new Error(error.message))}`);
      return;
    }
    query.refresh();
    router.push({ pathname: '/pm/[visitId]', params: { visitId: id } });
  }

  if (!isTechnician) {
    return <EmptyState title="PM is for technicians" message="Preventive maintenance is performed by Technicians." />;
  }
  if (query.loading) return <LoadingView label="Loading PM…" />;
  const today = toIsoDate(new Date());

  return (
    <FlatList
      data={query.data ?? []}
      keyExtractor={(r) => r.key}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={query.refreshing} onRefresh={query.refresh} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          {submitted ? <Banner tone="success" message="PM submitted. Your supervisor will review it." /> : null}
          {query.error ? <Banner tone="danger" message={query.error} /> : null}
          {startError ? <Banner tone="danger" message={startError} /> : null}
        </View>
      }
      ListEmptyComponent={query.error ? null : <EmptyState title="No PM to do" message="You have no open PM assignments." />}
      renderItem={({ item: r }) => {
        const overdue = r.due != null && isPmOverdue(r.status, r.due, today);
        return (
          <Card style={{ gap: spacing.sm }}>
            <View style={styles.row}>
              <Text style={styles.code}>{r.siteCode}</Text>
              <StatusPill status={overdue ? 'OVERDUE' : r.status} tone={overdue ? 'danger' : PM_STATUS_TONE[r.status]} />
            </View>
            <Text style={styles.name}>{r.siteName}</Text>
            <Text style={styles.meta}>
              {r.due ? `Due ${r.due}` : 'Unscheduled PM'}
              {r.frequency ? ` · ${humanizeStatus(r.frequency).toLowerCase()}` : ''}
              {r.completion != null ? ` · ${Math.round(r.completion)}% complete` : ''}
            </Text>
            {r.status === 'REJECTED' && r.review ? <Banner tone="danger" message={`Returned: ${r.review}`} /> : null}
            <PrimaryButton
              title={r.visitId ? (r.status === 'REJECTED' ? 'Fix & resubmit' : 'Continue PM') : 'Start PM'}
              loading={starting === r.key}
              onPress={() => void start(r)}
            />
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  name: { fontSize: 20, fontWeight: '800', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
});

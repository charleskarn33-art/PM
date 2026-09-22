import { isPmOverdue, OPEN_PM_STATUSES, PM_STATUS_TONE, toIsoDate } from '@ipt/shared';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, EmptyState, LoadingView, StatusPill } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useRemoteQuery } from '@/lib/use-remote-query';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

export default function PmScheduleScreen() {
  const { profile } = useAuth();
  const userId = profile?.id;
  const isTechnician = profile?.role === 'technician';

  const query = useRemoteQuery(async () => {
    if (!supabase || !userId) throw new Error('Not signed in.');
    if (!isTechnician) return [];
    const { data, error } = await supabase
      .from('pm_schedules')
      .select('id, status, priority, frequency, scheduled_date, due_date, sites(site_code, site_name)')
      .eq('technician_id', userId)
      .in('status', [...OPEN_PM_STATUSES, 'REJECTED'])
      .order('due_date');
    if (error) throw new Error(error.message);
    return data;
  }, `pm:${userId}:${isTechnician}`);

  if (!isTechnician) {
    return <EmptyState title="PM is for technicians" message="Preventive maintenance is performed by Technicians." />;
  }
  if (query.loading) return <LoadingView label="Loading PM schedule…" />;
  const today = toIsoDate(new Date());

  return (
    <FlatList
      data={query.data ?? []}
      keyExtractor={(s) => s.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={query.refreshing} onRefresh={query.refresh} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          {query.error ? <Banner tone="danger" message={query.error} /> : null}
          <Banner tone="info" message="Starting and completing PM checklists is delivered in Phase 3." />
        </View>
      }
      ListEmptyComponent={
        query.error ? null : <EmptyState title="No PM scheduled" message="You have no open PM assignments." />
      }
      renderItem={({ item }) => {
        const overdue = isPmOverdue(item.status, item.due_date, today);
        return (
          <Card>
            <View style={styles.row}>
              <Text style={styles.code}>{item.sites?.site_code}</Text>
              <StatusPill status={overdue ? 'OVERDUE' : item.status} tone={overdue ? 'danger' : PM_STATUS_TONE[item.status]} />
            </View>
            <Text style={styles.name}>{item.sites?.site_name}</Text>
            <Text style={styles.meta}>
              Due {item.due_date} · {item.frequency.toLowerCase()} · {item.priority.toLowerCase()} priority
            </Text>
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
  name: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: spacing.xs },
  meta: { fontSize: 15, color: colors.textMuted, marginTop: spacing.xs },
});

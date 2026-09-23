import { isPmOverdue, OPEN_PM_STATUSES, ROLE_LABELS, toIsoDate } from '@ipt/shared';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, LoadingView } from '@/components/ui';
import { SyncBar } from '@/components/sync-bar';
import { useAuth } from '@/providers/auth-provider';
import { useLocalQuery, useOffline } from '@/providers/offline-provider';
import { colors, spacing } from '@/theme';

export default function HomeScreen() {
  const { profile, profileFromCache } = useAuth();
  const { status, syncNow } = useOffline();
  const userId = profile?.id;

  const local = useLocalQuery(async (store) => {
    const today = toIsoDate(new Date());
    const [sites, schedules, actions] = await Promise.all([store.sites(), store.schedules(), store.actions()]);
    const mine = schedules.filter((s) => s.technician_id === userId && [...OPEN_PM_STATUSES, 'REJECTED'].includes(s.status));
    return {
      sites: sites.length,
      openPm: mine.length,
      overduePm: mine.filter((s) => isPmOverdue(s.status, s.due_date, today)).length,
      openActions: actions.filter((a) => a.status === 'OPEN' || a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS').length,
    };
  }, `home:${userId}`);

  if (local.loading) return <LoadingView />;
  const c = local.data;
  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} />}>
      <Text style={styles.hello}>Hello, {profile?.full_name || profile?.email}</Text>
      <Text style={styles.role}>{profile ? ROLE_LABELS[profile.role] : ''}</Text>
      <SyncBar />
      {profileFromCache ? <Banner tone="info" message="Working offline with the account details saved on this phone." /> : null}
      {local.error ? <Banner tone="danger" message={local.error} /> : null}
      {c ? (
        <View style={styles.grid}>
          <Stat label="My sites" value={c.sites} />
          <Stat label="Open PMs" value={c.openPm} />
          <Stat label="Overdue PMs" value={c.overduePm} danger={c.overduePm > 0} />
          <Stat label="My open actions" value={c.openActions} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function Stat({ label, value, danger }: { label: string; value: number | null; danger?: boolean }) {
  return (
    <Card style={styles.stat}>
      <Text style={[styles.statValue, danger && { color: '#b91c1c' }]}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  hello: { fontSize: 22, fontWeight: '800', color: colors.text },
  role: { fontSize: 15, color: colors.textMuted, marginTop: -spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { flexBasis: '47%', flexGrow: 1 },
  statValue: { fontSize: 32, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 15, color: colors.textMuted, marginTop: spacing.xs },
});

import { isPmOverdue, OPEN_PM_STATUSES, ROLE_LABELS, toIsoDate } from '@ipt/shared';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, LoadingView } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useRemoteQuery } from '@/lib/use-remote-query';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

interface HomeCounts {
  sites: number;
  openPm: number;
  overduePm: number;
  openActions: number;
}

export default function HomeScreen() {
  const { profile } = useAuth();
  const userId = profile?.id;

  const query = useRemoteQuery<HomeCounts>(async () => {
    if (!supabase || !userId) throw new Error('Not signed in.');
    const today = toIsoDate(new Date());
    const [sites, schedules, actions] = await Promise.all([
      supabase.from('sites').select('id', { count: 'exact', head: true }),
      supabase
        .from('pm_schedules')
        .select('status, due_date')
        .eq('technician_id', userId)
        .in('status', [...OPEN_PM_STATUSES, 'REJECTED']),
      supabase
        .from('corrective_actions')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', userId)
        .in('status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS']),
    ]);
    for (const r of [sites, schedules, actions]) if (r.error) throw new Error(r.error.message);
    const rows = schedules.data ?? [];
    return {
      sites: sites.count ?? 0,
      openPm: rows.length,
      overduePm: rows.filter((s) => isPmOverdue(s.status, s.due_date, today)).length,
      openActions: actions.count ?? 0,
    };
  }, `home:${userId}`);

  if (query.loading) return <LoadingView />;

  const c = query.data;
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={query.refreshing} onRefresh={query.refresh} />}
    >
      <Text style={styles.hello}>Hello, {profile?.full_name || profile?.email}</Text>
      <Text style={styles.role}>{profile ? ROLE_LABELS[profile.role] : ''}</Text>
      {query.error ? <Banner tone="danger" message={query.error} /> : null}
      {c ? (
        <View style={styles.grid}>
          <Stat label="My sites" value={c.sites} />
          <Stat label="Open PMs" value={c.openPm} />
          <Stat label="Overdue PMs" value={c.overduePm} danger={c.overduePm > 0} />
          <Stat label="My open actions" value={c.openActions} />
        </View>
      ) : null}
      <Banner
        tone="info"
        message="This build requires an Internet connection. Offline PM, GPS check-in, photos and sync are delivered in upcoming phases."
      />
    </ScrollView>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <Card style={styles.stat}>
      <Text style={[styles.statValue, danger && { color: '#b91c1c' }]}>{value}</Text>
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

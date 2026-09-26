import { ROLE_LABELS } from '@ipt/shared';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, LoadingView } from '@/components/ui';
import type { Schedule, VisitSummary } from '@/lib/api/types';
import { useApi } from '@/lib/api/use-api';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing, toneColors } from '@/theme';

/** Home: what needs doing today, from the server. */
export default function HomeScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const sites = useApi<unknown[]>('/sites?pageSize=1');
  const open = useApi<Schedule[]>('/pm-schedules?mine=true&status=SCHEDULED&pageSize=1');
  const overdue = useApi<Schedule[]>('/pm-schedules?mine=true&status=OVERDUE&pageSize=1');
  const inProgress = useApi<VisitSummary[]>('/visits?mine=true&status=IN_PROGRESS&pageSize=20');
  const returned = useApi<VisitSummary[]>('/visits?mine=true&status=REJECTED&pageSize=20');
  const all = [sites, open, overdue, inProgress, returned];
  const refreshing = all.some((q) => q.refreshing);
  const total = (q: { meta?: Record<string, unknown> }) => (typeof q.meta?.total === 'number' ? q.meta.total : 0);

  if (all.every((q) => q.loading)) return <LoadingView />;
  const error = all.find((q) => q.error)?.error;
  const working = [...(returned.data ?? []), ...(inProgress.data ?? [])];

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void Promise.all(all.map((q) => q.reload()))} />}>
      <Text style={styles.hello}>Hello, {profile?.full_name || profile?.email}</Text>
      <Text style={styles.role}>{profile?.role ? ROLE_LABELS[profile.role] : ''}</Text>
      {error ? <Banner tone="danger" message={error} /> : null}
      <View style={styles.grid}>
        <Stat label="My sites" value={total(sites)} onPress={() => router.push('/sites')} />
        <Stat label="Scheduled PMs" value={total(open)} onPress={() => router.push('/pm')} />
        <Stat label="Overdue PMs" value={total(overdue)} danger={total(overdue) > 0} onPress={() => router.push('/pm')} />
        <Stat label="PMs in progress" value={working.length} />
      </View>
      {working.length ? <Text style={styles.heading}>Continue</Text> : null}
      {working.map((v) => (
        <Pressable key={v.id} accessibilityRole="button" onPress={() => router.push(`/pm/${v.id}`)}>
          <Card>
            <Text style={styles.site}>
              {v.site.siteCode} · {v.site.siteName}
            </Text>
            <Text style={[styles.meta, v.status === 'REJECTED' && { color: toneColors.danger.fg }]}>
              {v.status === 'REJECTED' ? 'Returned for correction' : `In progress · ${Math.floor(v.completionPct)}% complete`}
            </Text>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Stat({ label, value, danger, onPress }: { label: string; value: number; danger?: boolean; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={styles.stat}>
      <Text style={[styles.statValue, danger && { color: toneColors.danger.fg }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  hello: { fontSize: 24, fontWeight: '800', color: colors.text },
  role: { fontSize: 16, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 12, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 32, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 15, color: colors.textMuted, marginTop: spacing.xs },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  site: { fontSize: 17, fontWeight: '700', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted, marginTop: spacing.xs },
});

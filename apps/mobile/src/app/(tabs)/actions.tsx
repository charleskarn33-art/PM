import { CORRECTIVE_ACTION_STATUS_TONE, PM_CATEGORY_LABELS, SEVERITY_TONE, toIsoDate } from '@ipt/shared';
import { Link } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SyncBar } from '@/components/sync-bar';
import { Banner, Card, EmptyState, LoadingView, StatusPill } from '@/components/ui';
import { useLocalQuery, useOffline } from '@/providers/offline-provider';
import { colors, spacing } from '@/theme';

const ORDER = ['IN_PROGRESS', 'ASSIGNED', 'OPEN', 'COMPLETED', 'VERIFIED', 'CLOSED'];

export default function ActionsScreen() {
  const { status, syncNow } = useOffline();
  const query = useLocalQuery(async (s) => ({ actions: await s.actions(), hasData: await s.hasData() }), 'actions');
  if (query.loading || !query.data) return <LoadingView label="Loading corrective actions…" />;
  const today = toIsoDate(new Date());
  const rows = [...query.data.actions].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(a) => a.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          <SyncBar />
          {query.error ? <Banner tone="danger" message={query.error} /> : null}
        </View>
      }
      ListEmptyComponent={
        query.data.hasData ? (
          <EmptyState title="No actions" message="No corrective actions are assigned to you." />
        ) : (
          <EmptyState title="Not downloaded yet" message="Connect to the Internet and pull down to download your work." />
        )
      }
      renderItem={({ item }) => {
        const overdue = item.due_date != null && item.due_date < today && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(item.status);
        return (
          <Link href={{ pathname: '/action/[id]', params: { id: item.id } }} asChild>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open corrective action ${item.action_number}`}>
              <Card style={{ gap: spacing.xs }}>
                <View style={styles.row}>
                  <Text style={styles.code}>
                    {item.action_number} · {item.site_code}
                  </Text>
                  <View style={styles.pills}>
                    {item.refused ? <StatusPill status="Refused" tone="danger" /> : item.pending ? <StatusPill status="Waiting to send" tone="info" /> : null}
                    <StatusPill status={item.status} tone={CORRECTIVE_ACTION_STATUS_TONE[item.status]} />
                  </View>
                </View>
                <Text style={styles.name}>{item.description}</Text>
                <Text style={styles.meta}>
                  {item.site_name} · {PM_CATEGORY_LABELS[item.category]}
                </Text>
                <View style={[styles.row, { marginTop: spacing.xs }]}>
                  <StatusPill status={item.priority} tone={SEVERITY_TONE[item.priority]} />
                  <Text style={[styles.meta, overdue && { color: '#b91c1c', fontWeight: '700' }]}>
                    {item.due_date ? `${overdue ? 'Overdue · ' : ''}Due ${item.due_date}` : 'No due date'}
                  </Text>
                </View>
              </Card>
            </Pressable>
          </Link>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  pills: { flexDirection: 'row', gap: spacing.xs, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  code: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  name: { fontSize: 18, fontWeight: '700', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
});

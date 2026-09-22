import { CORRECTIVE_ACTION_STATUS_TONE, PM_CATEGORY_LABELS, SEVERITY_TONE } from '@ipt/shared';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, EmptyState, LoadingView, StatusPill } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useRemoteQuery } from '@/lib/use-remote-query';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

export default function ActionsScreen() {
  const { profile } = useAuth();
  const userId = profile?.id;

  const query = useRemoteQuery(async () => {
    if (!supabase || !userId) throw new Error('Not signed in.');
    const { data, error } = await supabase
      .from('corrective_actions')
      .select('id, action_number, description, category, priority, status, due_date, sites(site_code, site_name)')
      .eq('assigned_to', userId)
      .neq('status', 'CLOSED')
      .order('due_date', { nullsFirst: false });
    if (error) throw new Error(error.message);
    return data;
  }, `actions:${userId}`);

  if (query.loading) return <LoadingView label="Loading corrective actions…" />;

  return (
    <FlatList
      data={query.data ?? []}
      keyExtractor={(a) => a.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={query.refreshing} onRefresh={query.refresh} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          {query.error ? <Banner tone="danger" message={query.error} /> : null}
          <Banner tone="info" message="Updating actions, repair notes and completion photos are delivered in Phase 6." />
        </View>
      }
      ListEmptyComponent={
        query.error ? null : <EmptyState title="No open actions" message="No corrective actions are assigned to you." />
      }
      renderItem={({ item }) => (
        <Card>
          <View style={styles.row}>
            <Text style={styles.code}>
              {item.action_number} · {item.sites?.site_code}
            </Text>
            <StatusPill status={item.status} tone={CORRECTIVE_ACTION_STATUS_TONE[item.status]} />
          </View>
          <Text style={styles.name}>{item.description}</Text>
          <Text style={styles.meta}>
            {item.sites?.site_name} · {PM_CATEGORY_LABELS[item.category]}
          </Text>
          <View style={[styles.row, { marginTop: spacing.sm }]}>
            <StatusPill status={item.priority} tone={SEVERITY_TONE[item.priority]} />
            <Text style={styles.meta}>{item.due_date ? `Due ${item.due_date}` : 'No due date'}</Text>
          </View>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  name: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: spacing.xs },
  meta: { fontSize: 15, color: colors.textMuted, marginTop: spacing.xs },
});

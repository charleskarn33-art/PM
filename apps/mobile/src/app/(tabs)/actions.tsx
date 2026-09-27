import { CORRECTIVE_ACTION_STATUS_TONE, SEVERITY_TONE, toIsoDate } from '@ipt/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SavedCopyNote } from '@/components/sync-bar';
import { Banner, Card, EmptyState, LoadingView, StatusPill } from '@/components/ui';
import type { CorrectiveActionSummary } from '@/lib/api/types';
import { useApi } from '@/lib/api/use-api';
import { dueText } from '@/pm/model';
import { colors, radius, spacing, toneColors } from '@/theme';

const FILTERS = [
  { key: 'active', label: 'To do' },
  { key: 'COMPLETED', label: 'Awaiting check' },
  { key: 'CLOSED', label: 'Closed' },
] as const;

/** Corrective actions assigned to the signed-in user. */
export default function ActionsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('active');
  const actions = useApi<CorrectiveActionSummary[]>(`/corrective-actions?assignedTo=me&status=${filter}&pageSize=100`);
  const today = toIsoDate(new Date());
  const rows = (actions.data ?? []).filter((a) => filter !== 'active' || a.status !== 'COMPLETED');

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.filters} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <Pressable key={f.key} accessibilityRole="tab" accessibilityState={{ selected: filter === f.key }} onPress={() => setFilter(f.key)} style={[styles.filter, filter === f.key && styles.filterOn]}>
            <Text style={[styles.filterText, filter === f.key && { color: colors.white }]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <SavedCopyNote savedAt={actions.savedAt} />
      </View>
      {actions.error ? <Banner tone="danger" message={actions.error} /> : null}
      {actions.loading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={actions.refreshing} onRefresh={() => void actions.reload()} />}
          ListEmptyComponent={<EmptyState title="Nothing here" message={filter === 'active' ? 'No corrective action is assigned to you.' : 'None yet.'} />}
          renderItem={({ item: a }) => {
            const late = a.dueDate != null && a.dueDate < today && (a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS');
            return (
              <Pressable accessibilityRole="button" onPress={() => router.push(`/action/${a.id}`)}>
                <Card style={{ gap: spacing.xs }}>
                  <View style={styles.row}>
                    <Text style={styles.number}>{a.number}</Text>
                    <StatusPill status={a.status} tone={CORRECTIVE_ACTION_STATUS_TONE[a.status]} />
                  </View>
                  <Text style={styles.title}>{a.title}</Text>
                  <Text style={styles.meta}>
                    {a.site.siteCode} · {a.site.siteName}
                  </Text>
                  <View style={styles.row}>
                    <Text style={[styles.meta, late && { color: toneColors.danger.fg, fontWeight: '700' }]}>{a.dueDate ? dueText(a.dueDate, today) : 'No due date'}</Text>
                    <StatusPill status={`${a.priority} priority`} tone={SEVERITY_TONE[a.priority]} />
                  </View>
                </Card>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: 0 },
  filter: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  filterOn: { backgroundColor: colors.navy },
  filterText: { fontSize: 15, fontWeight: '700', color: colors.navy, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  number: { fontSize: 14, fontWeight: '700', color: colors.red },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
});

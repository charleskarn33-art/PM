import { PM_STATUS_TONE, toIsoDate } from '@ipt/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, EmptyState, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import type { Schedule } from '@/lib/api/types';
import { useApi } from '@/lib/api/use-api';
import { dueText } from '@/pm/model';
import { colors, radius, spacing, toneColors } from '@/theme';

const FILTERS = [
  { key: 'open', label: 'To do' },
  { key: 'done', label: 'Done' },
] as const;

/** The technician's PM schedule: open PMs by due date; completed ones on the second tab. */
export default function PmScheduleScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('open');
  const schedules = useApi<Schedule[]>('/pm-schedules?mine=true&pageSize=100');
  const today = toIsoDate(new Date());
  const open = ['SCHEDULED', 'OVERDUE', 'IN_PROGRESS', 'REJECTED'];
  const rows = (schedules.data ?? []).filter((s) => (filter === 'open' ? open.includes(s.status) : !open.includes(s.status)));

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.filters} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <Pressable key={f.key} accessibilityRole="tab" accessibilityState={{ selected: filter === f.key }} onPress={() => setFilter(f.key)} style={[styles.filter, filter === f.key && styles.filterOn]}>
            <Text style={[styles.filterText, filter === f.key && { color: colors.white }]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {schedules.error ? <Banner tone="danger" message={schedules.error} /> : null}
      {schedules.loading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={schedules.refreshing} onRefresh={() => void schedules.reload()} />}
          ListEmptyComponent={<EmptyState title="Nothing here" message={filter === 'open' ? 'No PM is scheduled for you.' : 'No completed PMs yet.'} />}
          renderItem={({ item: s }) => (
            <Card style={{ gap: spacing.sm }}>
              <View style={styles.row}>
                <Text style={styles.site}>
                  {s.site.siteCode} · {s.site.siteName}
                </Text>
                <StatusPill status={s.status} tone={PM_STATUS_TONE[s.status]} />
              </View>
              <Text style={[styles.meta, s.status === 'OVERDUE' && { color: toneColors.danger.fg, fontWeight: '700' }]}>
                {open.includes(s.status) ? dueText(s.dueDate, today) : `Due ${s.dueDate}`} · {s.priority.toLowerCase()} priority
              </Text>
              <Text style={styles.meta}>
                {s.template.name} (v{s.template.version})
              </Text>
              {s.status === 'SCHEDULED' || s.status === 'OVERDUE' ? (
                <PrimaryButton title="Start PM" onPress={() => router.push({ pathname: '/pm/start', params: { scheduleId: s.id, siteId: s.siteId, siteName: `${s.site.siteCode} · ${s.site.siteName}` } })} />
              ) : s.status === 'IN_PROGRESS' || s.status === 'REJECTED' ? (
                <PrimaryButton title="Continue PM" variant="outline" onPress={() => router.push({ pathname: '/pm/start', params: { scheduleId: s.id, siteId: s.siteId, resume: '1' } })} />
              ) : null}
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: 0 },
  filter: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  filterOn: { backgroundColor: colors.navy },
  filterText: { fontSize: 16, fontWeight: '700', color: colors.navy },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  site: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
});

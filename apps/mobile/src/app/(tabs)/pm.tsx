import { PM_STATUS_TONE, toIsoDate } from '@ipt/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SavedCopyNote, SyncBar, SyncPill } from '@/components/sync-bar';
import { Banner, Card, EmptyState, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import type { Schedule } from '@/lib/api/types';
import { useApi } from '@/lib/api/use-api';
import { useOffline } from '@/offline/offline-provider';
import { useLocalVisits } from '@/offline/use-local-visits';
import { isEditable } from '@/offline/visit-ops';
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
  const { pack } = useOffline();
  const local = useLocalVisits();
  const today = toIsoDate(new Date());
  const open = ['SCHEDULED', 'OVERDUE', 'IN_PROGRESS', 'REJECTED'];
  // Never loaded on this phone and offline: the open PMs from the field pack.
  const list = schedules.data ?? (schedules.error ? (pack?.schedules ?? null) : null);
  const onPhone = (s: Schedule) => local.find((v) => v.visit.scheduleId === s.id && (isEditable(v.visit) || v.syncStatus !== 'SYNCED'));
  // A PM started or completed on the phone shows its state on the phone.
  const status = (s: Schedule) => onPhone(s)?.visit.status ?? s.status;
  const rows = (list ?? []).filter((s) => (filter === 'open' ? open.includes(status(s)) : !open.includes(status(s))));

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.filters} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <Pressable key={f.key} accessibilityRole="tab" accessibilityState={{ selected: filter === f.key }} onPress={() => setFilter(f.key)} style={[styles.filter, filter === f.key && styles.filterOn]}>
            <Text style={[styles.filterText, filter === f.key && { color: colors.white }]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm }}>
        <SyncBar />
        <SavedCopyNote savedAt={schedules.savedAt} />
        {!schedules.data && list ? <Text style={styles.meta}>Offline: showing the open PMs saved on this phone.</Text> : null}
      </View>
      {schedules.error && !list ? <Banner tone="danger" message={schedules.error} /> : null}
      {schedules.loading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={schedules.refreshing} onRefresh={() => void schedules.reload()} />}
          ListEmptyComponent={<EmptyState title="Nothing here" message={filter === 'open' ? 'No PM is scheduled for you.' : 'No completed PMs yet.'} />}
          renderItem={({ item: s }) => {
            const visit = onPhone(s);
            const st = status(s);
            return (
            <Card style={{ gap: spacing.sm }}>
              <View style={styles.row}>
                <Text style={styles.site}>
                  {s.site.siteCode} · {s.site.siteName}
                </Text>
                <StatusPill status={st} tone={PM_STATUS_TONE[st]} />
              </View>
              {visit && visit.syncStatus !== 'SYNCED' ? <SyncPill status={visit.syncStatus} /> : null}
              <Text style={[styles.meta, st === 'OVERDUE' && { color: toneColors.danger.fg, fontWeight: '700' }]}>
                {open.includes(st) ? dueText(s.dueDate, today) : `Due ${s.dueDate}`} · {s.priority.toLowerCase()} priority
              </Text>
              <Text style={styles.meta}>
                {s.template.name} (v{s.template.version})
              </Text>
              {visit ? (
                <PrimaryButton title={isEditable(visit.visit) ? 'Continue PM' : 'Open PM'} variant="outline" onPress={() => router.push(`/pm/${visit.visit.id}`)} />
              ) : s.status === 'SCHEDULED' || s.status === 'OVERDUE' ? (
                <PrimaryButton title="Start PM" onPress={() => router.push({ pathname: '/pm/start', params: { scheduleId: s.id, siteId: s.siteId, siteName: `${s.site.siteCode} · ${s.site.siteName}` } })} />
              ) : s.status === 'IN_PROGRESS' || s.status === 'REJECTED' ? (
                <PrimaryButton title="Continue PM" variant="outline" onPress={() => router.push({ pathname: '/pm/start', params: { scheduleId: s.id, siteId: s.siteId, resume: '1' } })} />
              ) : null}
            </Card>
            );
          }}
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

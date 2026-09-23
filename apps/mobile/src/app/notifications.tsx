import { humanizeStatus } from '@ipt/shared';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { EmptyState, LoadingView } from '@/components/ui';
import { notificationTarget } from '@/lib/notification-target';
import type { AppNotification } from '@/offline/types';
import { useLocalQuery, useOffline } from '@/providers/offline-provider';
import { colors, spacing, toneColors } from '@/theme';

export default function NotificationsScreen() {
  const { store, changed, status, syncNow } = useOffline();
  const router = useRouter();
  const query = useLocalQuery((s) => s.notifications(), 'notifications');
  if (query.loading || !query.data) return <LoadingView />;

  async function open(n: AppNotification) {
    if (store && !n.read_at) {
      await store.markNotificationRead(n.id);
      changed();
    }
    const target = notificationTarget(n);
    if (target) router.push(target);
  }

  return (
    <FlatList
      data={query.data}
      keyExtractor={(n) => n.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} />}
      ListEmptyComponent={<EmptyState title="No notifications" message="You're all caught up." />}
      renderItem={({ item: n }) => (
        <Pressable accessibilityRole="button" onPress={() => void open(n)} style={[styles.item, !n.read_at && styles.unread]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.title, !n.read_at && { fontWeight: '800' }]}>{n.title}</Text>
            {n.body ? <Text style={styles.body}>{n.body}</Text> : null}
            <Text style={styles.meta}>
              {humanizeStatus(n.type)} · {new Date(n.created_at).toLocaleString()}
            </Text>
          </View>
          {!n.read_at ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, minHeight: 64 },
  unread: { backgroundColor: toneColors.info.bg, borderColor: toneColors.info.bg },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: toneColors.info.fg },
});

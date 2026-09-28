import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Banner, EmptyState, LoadingView, PrimaryButton } from '@/components/ui';
import { sessionClient } from '@/lib/api/session';
import { useApi } from '@/lib/api/use-api';
import { notificationRoute } from '@/lib/notification-routes';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** The user's notifications, newest first; opening one marks it read. */
export default function NotificationsScreen() {
  const pmWork = useAuth().profile?.role !== 'maintenance';
  const q = useApi<Item[]>('/notifications?pageSize=50');
  const [readNow, setReadNow] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const { reload } = q;
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const isRead = (n: Item) => Boolean(n.readAt) || readNow.has(n.id);
  const unread = (q.data ?? []).filter((n) => !isRead(n)).length;

  async function open(n: Item) {
    if (!isRead(n)) {
      try {
        await sessionClient?.request(`/notifications/${n.id}/read`, { method: 'POST' });
        setReadNow((s) => new Set(s).add(n.id));
        setProblem(null);
      } catch {
        setProblem('Marking as read needs a connection.');
      }
    }
    const route = notificationRoute(n.entityType, n.entityId, pmWork);
    if (route) router.push(route as Href);
  }

  async function readAll() {
    try {
      await sessionClient?.request('/notifications/read-all', { method: 'POST' });
      setReadNow(new Set((q.data ?? []).map((n) => n.id)));
      setProblem(null);
    } catch {
      setProblem('Marking as read needs a connection.');
    }
  }

  if (q.loading) return <LoadingView />;
  return (
    <FlatList
      data={q.data ?? []}
      keyExtractor={(n) => n.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={() => void q.reload()} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          {q.error ? <Banner tone="danger" message={q.error} /> : null}
          {q.savedAt ? <Banner tone="warning" message={`No connection — showing notifications saved ${q.savedAt.slice(0, 16).replace('T', ' ')}.`} /> : null}
          {problem ? <Banner tone="warning" message={problem} /> : null}
          {unread ? <PrimaryButton title={`Mark all read (${unread})`} variant="outline" onPress={() => void readAll()} /> : null}
        </View>
      }
      ListEmptyComponent={<EmptyState title="No notifications" message="You are told here when work is assigned to you or needs your attention." />}
      renderItem={({ item }) => (
        <Pressable onPress={() => void open(item)} style={({ pressed }) => [styles.item, !isRead(item) && styles.unread, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${isRead(item) ? '' : 'Unread. '}${item.title}. ${item.body}`}>
          <Text style={[styles.title, !isRead(item) && styles.bold]}>{item.title}</Text>
          <Text style={styles.body}>{item.body}</Text>
          <Text style={styles.when}>{item.createdAt.slice(0, 16).replace('T', ' ')}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.sm },
  item: { backgroundColor: colors.white, borderRadius: 12, padding: spacing.lg, gap: spacing.xs, borderWidth: 1, borderColor: colors.border },
  unread: { borderLeftWidth: 4, borderLeftColor: colors.red },
  title: { fontSize: 16, color: colors.text },
  bold: { fontWeight: '700' },
  body: { fontSize: 15, color: colors.textMuted },
  when: { fontSize: 13, color: colors.textMuted },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useApi } from '@/lib/api/use-api';
import { colors } from '@/theme';

/** Header bell with the unread count (refreshed whenever a tab comes into view). */
export function NotificationBell() {
  const q = useApi<{ unread: number }>('/notifications/unread-count');
  const { reload } = q;
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  const n = q.data?.unread ?? 0;
  return (
    <Pressable onPress={() => router.push('/notifications')} style={styles.bell} accessibilityRole="button" accessibilityLabel={n ? `Notifications, ${n} unread` : 'Notifications'} hitSlop={8}>
      <Ionicons name="notifications" size={24} color={colors.white} />
      {n ? <Text style={styles.badge}>{n > 99 ? '99+' : n}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: { marginRight: 16, padding: 4 },
  badge: {
    position: 'absolute',
    right: -4,
    top: -2,
    minWidth: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.red,
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    overflow: 'hidden',
  },
});

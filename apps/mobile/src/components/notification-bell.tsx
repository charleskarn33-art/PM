import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalQuery } from '@/providers/offline-provider';
import { colors } from '@/theme';

/** Header bell with the number of unread notifications on this phone. */
export function NotificationBell() {
  const query = useLocalQuery((s) => s.unreadCount(), 'unread');
  const unread = query.data ?? 0;
  return (
    <Link href="/notifications" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'} style={styles.button}>
        <Ionicons name="notifications" size={24} color={colors.white} />
        {unread ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  badge: { position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '800' },
});

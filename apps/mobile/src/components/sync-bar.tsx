import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useNow } from '@/lib/use-now';
import { syncSummary } from '@/offline/status-text';
import { useOffline } from '@/providers/offline-provider';
import { radius, spacing, toneColors } from '@/theme';

/** Tappable one-line sync status; opens the Sync status screen. */
export function SyncBar() {
  const { status } = useOffline();
  const now = useNow();
  const { tone, text } = syncSummary(
    {
      syncing: status.syncing,
      online: status.online,
      pending: status.outbox.pending,
      errors: status.outbox.errors.length,
      lastSyncedAt: status.lastSyncedAt,
      lastError: status.lastResult?.error ?? null,
    },
    now,
  );
  const c = toneColors[tone];
  return (
    <Link href="/sync" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`Sync status: ${text}`} style={[styles.bar, { backgroundColor: c.bg }]}>
        <Text style={[styles.text, { color: c.fg }]}>{text}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 44, borderRadius: radius.sm, paddingHorizontal: spacing.md, justifyContent: 'center' },
  text: { fontSize: 15, fontWeight: '600' },
});

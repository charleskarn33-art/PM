import type { StatusTone } from '@ipt/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useOffline } from '@/offline/offline-provider';
import type { SyncStatus } from '@/offline/visit-ops';
import { colors, radius, spacing, toneColors } from '@/theme';
import { StatusPill } from './ui';

export const SYNC_LABEL: Record<SyncStatus, string> = {
  LOCAL: 'Only on this phone',
  PENDING_SYNC: 'Waiting to sync',
  SYNCING: 'Syncing…',
  SYNCED: 'Synced',
  SYNC_ERROR: 'Sync error',
};

export const SYNC_TONE: Record<SyncStatus, StatusTone> = {
  LOCAL: 'warning',
  PENDING_SYNC: 'warning',
  SYNCING: 'info',
  SYNCED: 'success',
  SYNC_ERROR: 'danger',
};

export function SyncPill({ status }: { status: SyncStatus }) {
  return <StatusPill status={SYNC_LABEL[status]} tone={SYNC_TONE[status]} />;
}

const time = (iso: string) => iso.slice(11, 16);

/** The phone's sync state in one line, with "Sync now". Hidden when everything is sent and there is a connection. */
export function SyncBar() {
  const { counts, syncing, online, problem, syncNow, lastSyncAt } = useOffline();
  const waiting = counts.pending + counts.syncing;
  let tone: StatusTone;
  let text: string;
  if (counts.errors) {
    tone = 'danger';
    text = `${counts.errors} change${counts.errors === 1 ? '' : 's'} refused by the server. Open the PM to fix or discard.`;
  } else if (syncing) {
    tone = 'info';
    text = 'Syncing…';
  } else if (online === false || problem) {
    tone = 'warning';
    text = `${problem ?? 'No connection.'}${waiting ? ` ${waiting} change${waiting === 1 ? '' : 's'} saved on this phone.` : ''}`;
  } else if (waiting) {
    tone = 'warning';
    text = `${waiting} change${waiting === 1 ? '' : 's'} waiting to sync.`;
  } else {
    return null;
  }
  const c = toneColors[tone];
  return (
    <View style={[styles.bar, { backgroundColor: c.bg }]} accessibilityLiveRegion="polite">
      <Text style={[styles.text, { color: c.fg }]}>
        {text}
        {lastSyncAt ? ` Last synced ${time(lastSyncAt)}.` : ''}
      </Text>
      {!syncing ? (
        <Pressable accessibilityRole="button" onPress={() => void syncNow()} style={styles.button}>
          <Text style={styles.buttonText}>Sync now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A note that the list shows the copy saved on the phone. */
export function SavedCopyNote({ savedAt }: { savedAt: string | null }) {
  if (!savedAt) return null;
  return <Text style={styles.note}>Offline: showing the copy saved {savedAt.slice(0, 16).replace('T', ' ')}.</Text>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  text: { flex: 1, fontSize: 15, fontWeight: '600' },
  button: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.navy, justifyContent: 'center' },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  note: { fontSize: 14, color: colors.textMuted },
});

import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type { StoredOp } from '@/offline/store';
import { useVisit } from '@/pm/visit-context';
import { colors, spacing } from '@/theme';
import { SyncPill } from './sync-bar';
import { Banner, Card, PrimaryButton } from './ui';

const CHANGE: Record<StoredOp['kind'], string> = {
  start: 'Starting this PM',
  answers: 'Answers and readings',
  battery: 'Battery voltages',
  photo: 'A photo',
  photo_delete: 'Removing a photo',
  sign: 'The signature',
  complete: 'Completing the PM',
};

const EXPLAIN = {
  LOCAL: 'Started on this phone; it is sent to the server when there is a connection.',
  PENDING_SYNC: 'Changes are saved on this phone and sent when there is a connection.',
  SYNCING: 'Sending changes…',
  SYNCED: 'Everything is saved on the server.',
  SYNC_ERROR: '',
} as const;

/** The visit's sync state; a change the server refused can be sent again or discarded. */
export function VisitSync() {
  const pm = useVisit();
  const router = useRouter();

  function discard() {
    const start = pm.syncError?.kind === 'start';
    Alert.alert(
      start ? 'Discard this PM?' : 'Discard this change?',
      start ? 'The server did not accept this PM. Everything recorded in it on this phone will be removed.' : 'The change is removed from this phone. The server keeps its own values.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => void pm.discardRefused().then((r) => r.visitRemoved && router.replace('/pm')),
        },
      ],
    );
  }

  return (
    <>
      <Card style={{ gap: spacing.sm }}>
        <View style={styles.row}>
          <Text style={styles.label}>Sync</Text>
          <SyncPill status={pm.syncStatus} />
        </View>
        {pm.syncError ? (
          <>
            <Text style={styles.error}>
              {CHANGE[pm.syncError.kind]} was not accepted: {pm.syncError.message}
            </Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Try again" variant="outline" onPress={() => void pm.retrySync()} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Discard" variant="outline" onPress={discard} />
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.meta}>{EXPLAIN[pm.syncStatus]}</Text>
        )}
      </Card>
      {pm.notice ? (
        <View style={{ gap: spacing.xs }}>
          <Banner tone="info" message={pm.notice} />
          <PrimaryButton title="OK" variant="outline" onPress={() => void pm.dismissNotice()} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  label: { fontSize: 17, fontWeight: '700', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  error: { fontSize: 15, color: colors.text },
});

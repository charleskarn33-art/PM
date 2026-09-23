import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, PrimaryButton } from '@/components/ui';
import { SyncBar } from '@/components/sync-bar';
import { useNow } from '@/lib/use-now';
import { timeAgo } from '@/offline/status-text';
import type { OpKind, OutboxOp } from '@/offline/types';
import { useLocalQuery, useOffline } from '@/providers/offline-provider';
import { colors, spacing } from '@/theme';

const KIND_LABEL: Record<OpKind, string> = {
  'visit.create': 'Start PM',
  'visit.update': 'PM details',
  'visit.submit': 'Submit PM',
  'response.upsert': 'Checklist answer',
  'reading.upsert': 'Reading',
  'photo.upload': 'Photo',
  'action.update': 'Corrective action status',
  'action.note': 'Corrective action note',
  'notification.read': 'Notification read',
};

export default function SyncScreen() {
  const { store, status, syncNow, changed, deleteFiles } = useOffline();
  const [message, setMessage] = useState<string | null>(null);
  const now = useNow();
  const query = useLocalQuery(async (s) => {
    const [ops, visits, sites, actions] = await Promise.all([s.ops(), s.visits(), s.sites(), s.actions()]);
    const siteName = new Map(sites.map((x) => [x.id, `${x.site_code} ${x.site_name}`]));
    const label = new Map<string, string>(visits.map((v) => [v.id, `PM · ${siteName.get(v.site_id) ?? ''}`]));
    for (const a of actions) label.set(a.id, `${a.action_number} · ${a.site_code} ${a.site_name}`);
    return { ops, label };
  }, 'sync');

  const ops = query.data?.ops ?? [];
  const byVisit = new Map<string, OutboxOp[]>();
  for (const op of ops) byVisit.set(op.visit_id, [...(byVisit.get(op.visit_id) ?? []), op]);

  function confirmDiscard(visitId: string, name: string) {
    Alert.alert(
      'Discard unsent changes?',
      `The changes for ${name} that have not reached the server will be deleted from this phone, including photos not uploaded. This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void store?.discardVisitChanges(visitId).then((files) => {
              deleteFiles(files);
              changed();
              setMessage('Unsent changes discarded. The server copy is restored on the next sync.');
            });
          },
        },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} />}>
      <SyncBar />
      <Card style={{ gap: spacing.xs }}>
        <Row label="Connection" value={status.online == null ? 'Checking…' : status.online ? 'Online' : 'Offline'} />
        <Row label="Last download" value={timeAgo(status.lastSyncedAt, now)} />
        <Row label="Waiting to send" value={String(status.outbox.pending)} />
        {status.lastResult?.error ? <Row label="Last problem" value={status.lastResult.error} /> : null}
        {status.outbox.nextAttemptAt && !status.syncing ? (
          <Row label="Next automatic retry" value={new Date(status.outbox.nextAttemptAt).toLocaleTimeString()} />
        ) : null}
      </Card>
      <PrimaryButton title="Sync now" loading={status.syncing} onPress={() => void syncNow()} />
      {message ? <Banner tone="info" message={message} /> : null}
      {query.error ? <Banner tone="danger" message={query.error} /> : null}

      {[...byVisit].map(([visitId, list]) => {
        const name = query.data?.label.get(visitId) ?? (list.every((o) => o.kind === 'notification.read') ? 'Notifications' : 'PM');
        const errors = list.filter((o) => o.state === 'ERROR');
        return (
          <Card key={visitId} style={{ gap: spacing.sm }}>
            <Text style={styles.title}>{name}</Text>
            <Text style={styles.meta}>
              {list.length} change(s) not yet on the server:{' '}
              {Object.entries(countBy(list.map((o) => KIND_LABEL[o.kind])))
                .map(([k, n]) => `${n} × ${k.toLowerCase()}`)
                .join(', ')}
            </Text>
            {errors.map((o) => (
              <Banner key={o.seq} tone="danger" message={`${KIND_LABEL[o.kind]} refused: ${o.last_error ?? 'unknown reason'}`} />
            ))}
            {errors.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={styles.meta}>
                  Later changes to this PM wait until this is resolved. Fix the cause (for example ask your supervisor), then retry — or discard the unsent changes.
                </Text>
                <PrimaryButton
                  title="Retry"
                  onPress={() => {
                    void store?.retry(visitId).then(() => {
                      changed();
                      void syncNow();
                    });
                  }}
                />
                {errors.some((o) => o.kind === 'visit.submit') ? (
                  <PrimaryButton
                    title="Withdraw submission and keep editing"
                    variant="outline"
                    onPress={() => {
                      void store?.withdrawSubmission(visitId).then(
                        () => {
                          changed();
                          setMessage('Submission withdrawn. Complete the PM and submit again.');
                        },
                        (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
                      );
                    }}
                  />
                ) : null}
                <PrimaryButton title="Discard unsent changes" variant="outline" onPress={() => confirmDiscard(visitId, name)} />
              </View>
            ) : null}
          </Card>
        );
      })}
      {ops.length === 0 && !query.loading ? <Text style={styles.meta}>Everything on this phone has been sent.</Text> : null}
    </ScrollView>
  );
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 2 },
  label: { fontSize: 15, color: colors.textMuted },
  value: { fontSize: 15, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});

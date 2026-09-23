import { CORRECTIVE_ACTION_STATUS_TONE, humanizeStatus, PM_CATEGORY_LABELS, SEVERITY_TONE } from '@ipt/shared';
import { randomUUID } from 'expo-crypto';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Banner, Card, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import type { LocalPhoto } from '@/offline/types';
import { useLocalQuery, useOffline } from '@/providers/offline-provider';
import { colors, radius, spacing, toneColors } from '@/theme';

const when = (v: string) => new Date(v).toLocaleString();

export default function ActionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, changed, deleteFiles } = useOffline();
  const query = useLocalQuery((s) => s.actionData(id), `action:${id}`);
  const [resolution, setResolution] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (query.loading) return <LoadingView />;
  const data = query.data;
  if (!data) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Banner tone="danger" message={query.error ?? 'This corrective action is not on the phone. Pull down on the Actions list to sync.'} />
      </View>
    );
  }
  const a = data.action;
  const workable = a.status === 'OPEN' || a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS';

  async function run(fn: () => Promise<unknown>, ok: string) {
    if (!store) return;
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      changed();
      setMessage({ tone: 'success', text: ok });
      return true;
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(p: LocalPhoto) {
    Alert.alert('Remove photo?', 'This photo has not been uploaded yet and will be deleted from the phone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void store
            ?.removeUnsentPhoto(p.id)
            .then((files) => {
              deleteFiles(files);
              changed();
            })
            .catch((e: unknown) => setMessage({ tone: 'danger', text: e instanceof Error ? e.message : String(e) }));
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ title: a.action_number }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.pills}>
            <StatusPill status={a.status} tone={CORRECTIVE_ACTION_STATUS_TONE[a.status]} />
            <StatusPill status={a.priority} tone={SEVERITY_TONE[a.priority]} />
          </View>
          <Text style={styles.title}>{a.description}</Text>
          <Text style={styles.meta}>
            {a.site_code} {a.site_name} · {PM_CATEGORY_LABELS[a.category]} · {a.due_date ? `Due ${a.due_date}` : 'No due date'}
          </Text>
          {a.failure_number ? (
            <Card style={{ gap: spacing.xs }}>
              <Text style={styles.label}>Failure {a.failure_number}</Text>
              <Text style={styles.body}>{a.failure_description}</Text>
            </Card>
          ) : null}
          {data.errors.map((o) => (
            <Banner key={o.seq} tone="danger" message={`The server refused a change: ${o.last_error ?? 'unknown reason'}`} />
          ))}
          {message ? <Banner tone={message.tone} message={message.text} /> : null}
          {a.resolution ? <Banner tone={a.status === 'COMPLETED' ? 'info' : 'success'} message={`Resolution: ${a.resolution}`} /> : null}

          {workable ? (
            <Card style={{ gap: spacing.md }}>
              {a.status !== 'IN_PROGRESS' ? (
                <PrimaryButton title="Start work" loading={busy} onPress={() => void run(() => store!.updateAction(id, { status: 'IN_PROGRESS' }), 'Work started. It will be sent automatically.')} />
              ) : null}
              <Text style={styles.label}>What was done</Text>
              <TextInput
                accessibilityLabel="What was done"
                style={styles.input}
                value={resolution}
                onChangeText={setResolution}
                multiline
                placeholder="Parts replaced, tests performed, readings after repair"
              />
              <PrimaryButton
                title="Mark completed"
                loading={busy}
                disabled={resolution.trim().length < 5}
                onPress={() =>
                  void run(() => store!.updateAction(id, { status: 'COMPLETED', resolution: resolution.trim() }), 'Marked completed. Your supervisor will verify it.').then(
                    (ok) => ok && setResolution(''),
                  )
                }
              />
            </Card>
          ) : null}

          <Card style={{ gap: spacing.sm }}>
            <Text style={styles.label}>Photos</Text>
            <ScrollView horizontal contentContainerStyle={{ gap: spacing.sm }}>
              {data.photos.map((p) => (
                <Pressable key={p.id} onLongPress={p.pending ? () => confirmRemove(p) : undefined} accessibilityLabel={p.pending ? 'Photo waiting to upload. Long press to remove.' : 'Uploaded photo'}>
                  {p.thumb_uri || p.local_uri ? (
                    <Image source={{ uri: p.thumb_uri ?? p.local_uri! }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.placeholder]}>
                      <Text style={styles.small}>On server</Text>
                    </View>
                  )}
                  <Text style={[styles.small, { color: p.pending ? toneColors.info.fg : toneColors.success.fg }]}>{p.pending ? 'Waiting' : 'Uploaded'}</Text>
                </Pressable>
              ))}
              {a.status !== 'CLOSED' && a.status !== 'VERIFIED' ? (
                <Link href={{ pathname: '/action/[id]/camera', params: { id } }} asChild>
                  <Pressable accessibilityRole="button" accessibilityLabel="Add photo" style={[styles.thumb, styles.add]}>
                    <Text style={styles.addText}>+ Photo</Text>
                  </Pressable>
                </Link>
              ) : null}
            </ScrollView>
          </Card>

          <Card style={{ gap: spacing.sm }}>
            <Text style={styles.label}>Timeline</Text>
            {a.updates.length === 0 ? <Text style={styles.meta}>No updates yet.</Text> : null}
            {a.updates.map((u) => (
              <View key={u.id} style={styles.update}>
                <Text style={styles.small}>
                  {when(u.created_at)}
                  {u.author_name ? ` · ${u.author_name}` : ''}
                  {u.pending ? ' · waiting to send' : ''}
                </Text>
                {u.to_status ? (
                  <Text style={styles.body}>
                    {u.from_status ? `${humanizeStatus(u.from_status)} → ` : ''}
                    {humanizeStatus(u.to_status)}
                  </Text>
                ) : null}
                {u.note ? <Text style={styles.body}>{u.note}</Text> : null}
              </View>
            ))}
            <TextInput accessibilityLabel="Add a note" style={styles.input} value={note} onChangeText={setNote} multiline placeholder="Add a note (e.g. parts ordered)" />
            <PrimaryButton
              title="Add note"
              variant="outline"
              loading={busy}
              disabled={!note.trim()}
              onPress={() => void run(() => store!.addActionNote(id, randomUUID(), note), 'Note saved. It will be sent automatically.').then((ok) => ok && setNote(''))}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  pills: { flexDirection: 'row', gap: spacing.xs },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  label: { fontSize: 16, fontWeight: '800', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 12, color: colors.textMuted },
  update: { borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: spacing.sm, gap: 2 },
  input: { minHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, fontSize: 16, color: colors.text, textAlignVertical: 'top' },
  thumb: { width: 88, height: 88, borderRadius: radius.sm, backgroundColor: '#e5e7eb' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: colors.navy, backgroundColor: 'transparent' },
  addText: { color: colors.navy, fontWeight: '700', fontSize: 15 },
});

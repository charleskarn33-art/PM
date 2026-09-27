import { CORRECTIVE_ACTION_STATUS_TONE, SEVERITY_TONE } from '@ipt/shared';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Banner, Card, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import { errorMessage } from '@/lib/api/errors';
import { sessionClient } from '@/lib/api/session';
import type { CorrectiveActionDetail } from '@/lib/api/types';
import { useApi } from '@/lib/api/use-api';
import { useAuth } from '@/providers/auth-provider';
import { colors, radius, spacing, touchTarget } from '@/theme';

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const statusText = (s: string | null) => (s ? s.toLowerCase().replace('_', ' ') : '');

/**
 * One corrective action: the failure it resolves, what to do, the timeline,
 * and the assignee's steps (start, notes, photos, complete). Changes need a
 * connection; without one the saved copy is shown.
 */
export default function ActionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { userId } = useAuth();
  const action = useApi<CorrectiveActionDetail>(`/corrective-actions/${id}`);
  const [comment, setComment] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Back from the camera: show the new photo.
  const { reload } = action;
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) void reload();
      focused.current = true;
    }, [reload]),
  );

  if (action.loading) return <LoadingView />;
  const a = action.data;
  if (!a) return <Banner tone="danger" message={action.error ?? 'Corrective action not found.'} />;
  const mine = a.assignedTo?.id === userId;
  const offline = Boolean(action.savedAt);

  async function send(path: string, body: object | undefined, what: string, after?: () => void) {
    if (!sessionClient) return;
    setBusy(true);
    setMessage(null);
    try {
      await sessionClient.request(path, { method: 'POST', body });
      after?.();
      await action.reload();
    } catch (e) {
      setMessage(errorMessage(e, what));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={action.refreshing} onRefresh={() => void action.reload()} />}>
      <Stack.Screen options={{ title: a.number }} />
      {offline ? <Banner tone="warning" message={`No connection: showing the copy saved ${when(action.savedAt!)}. Connect to make changes.`} /> : null}
      <Card style={{ gap: spacing.sm }}>
        <View style={styles.row}>
          <Text style={styles.title}>{a.title}</Text>
          <StatusPill status={a.status} tone={CORRECTIVE_ACTION_STATUS_TONE[a.status]} />
        </View>
        {a.description ? <Text style={styles.body}>{a.description}</Text> : null}
        <Text style={styles.meta}>
          {a.site.siteCode} · {a.site.siteName}
        </Text>
        <Text style={styles.meta}>
          {a.priority.toLowerCase()} priority{a.dueDate ? ` · due ${a.dueDate}` : ''}
        </Text>
        {a.verificationNote && a.status === 'IN_PROGRESS' ? <Banner tone="danger" message={`Sent back: ${a.verificationNote}`} /> : null}
      </Card>

      <Card style={{ gap: spacing.xs }}>
        <View style={styles.row}>
          <Text style={styles.label}>
            Failure {a.failure.number}
          </Text>
          <StatusPill status={a.failure.severity} tone={SEVERITY_TONE[a.failure.severity]} />
        </View>
        <Text style={styles.body}>{a.failure.title}</Text>
        {a.failure.description ? <Text style={styles.meta}>{a.failure.description}</Text> : null}
      </Card>

      {message ? <Banner tone="danger" message={message} /> : null}

      {mine && !offline && a.status === 'ASSIGNED' ? <PrimaryButton title="Start work" loading={busy} onPress={() => void send(`/corrective-actions/${a.id}/start`, undefined, 'start the action')} /> : null}

      {mine && !offline && a.status === 'IN_PROGRESS' ? (
        <Card style={{ gap: spacing.sm }}>
          <Text style={styles.label}>What was done</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote} multiline maxLength={2000} placeholder="Describe the repair" placeholderTextColor={colors.textMuted} accessibilityLabel="What was done" />
          <PrimaryButton title="Take photo" variant="outline" onPress={() => router.push(`/action/${a.id}/camera`)} disabled={busy} />
          <PrimaryButton title="Mark completed" loading={busy} disabled={!note.trim()} onPress={() => void send(`/corrective-actions/${a.id}/complete`, { note: note.trim() }, 'complete the action', () => setNote(''))} />
        </Card>
      ) : null}

      <Text style={styles.heading}>Photos and documents</Text>
      {a.attachments.length ? (
        a.attachments.map((f) => (
          <Text key={f.id} style={styles.meta}>
            {f.kind === 'PHOTO' ? '📷' : '📄'} {f.caption ?? f.fileName} — {f.uploadedBy.fullName}, {when(f.createdAt)}
          </Text>
        ))
      ) : (
        <Text style={styles.meta}>None yet.</Text>
      )}

      <Text style={styles.heading}>Timeline</Text>
      {a.updates.map((u) => (
        <Card key={u.id} style={{ gap: spacing.xs }}>
          <Text style={styles.meta}>
            {when(u.createdAt)} · {u.author?.fullName ?? 'System'}
          </Text>
          {u.kind === 'STATUS' && u.toStatus ? <Text style={styles.label}>{u.fromStatus ? `${statusText(u.fromStatus)} → ${statusText(u.toStatus)}` : statusText(u.toStatus)}</Text> : null}
          {u.body ? <Text style={styles.body}>{u.body}</Text> : null}
        </Card>
      ))}

      {!offline && a.status !== 'CLOSED' ? (
        <Card style={{ gap: spacing.sm }}>
          <TextInput style={styles.input} value={comment} onChangeText={setComment} multiline maxLength={4000} placeholder="Add a note" placeholderTextColor={colors.textMuted} accessibilityLabel="Add a note" />
          <PrimaryButton title="Add note" variant="outline" loading={busy} disabled={!comment.trim()} onPress={() => void send(`/corrective-actions/${a.id}/comments`, { body: comment.trim() }, 'add the note', () => setComment(''))} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 80 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  label: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  input: {
    minHeight: touchTarget * 2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 17,
    color: colors.text,
    textAlignVertical: 'top',
    backgroundColor: colors.white,
  },
});

import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ProgressBar } from '@/components/answer-controls';
import { SignaturePad, type Stroke } from '@/components/signature-pad';
import { hasSignature } from '@/lib/signature';
import { Banner, Card, LoadingView, PrimaryButton } from '@/components/ui';
import { VisitSync } from '@/components/visit-sync';
import { ISSUE_TEXT, completionMessage, issuesBySection } from '@/pm/model';
import { useVisit } from '@/pm/visit-context';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

const PAD_HEIGHT = 200;

/** Review & complete: everything still missing, the technician's signature, then completion. */
export default function ReviewScreen() {
  const pm = useVisit();
  const { profile } = useAuth();
  const router = useRouter();
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [padWidth, setPadWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (pm.loading || !pm.visit) return <LoadingView />;
  const v = pm.visit;
  const others = v.issues.filter((i) => i.kind !== 'SIGNATURE_REQUIRED');
  const groups = issuesBySection(others);
  const sectionName = (code: string) => v.sections.find((s) => s.code === code)?.name ?? code;
  const needsSignature = v.issues.some((i) => i.kind === 'SIGNATURE_REQUIRED');

  async function sign() {
    if (!hasSignature(strokes) || !padWidth) return setMessage('Sign in the box first.');
    setBusy(true);
    setMessage(await pm.sign({ width: padWidth, height: PAD_HEIGHT, strokes, name: profile?.full_name }));
    setStrokes([]);
    setBusy(false);
  }

  async function complete() {
    setBusy(true);
    const r = await pm.complete();
    setBusy(false);
    if (r.ok) router.replace('/pm');
    else setMessage(r.message);
  }

  return (
    <ScrollView contentContainerStyle={styles.container} scrollEnabled={strokes.length === 0 || !needsSignature}>
      <Stack.Screen options={{ title: 'Review & complete' }} />
      <VisitSync />
      <Card style={{ gap: spacing.sm }}>
        <ProgressBar pct={v.progress.completionPct} />
        <Text style={styles.meta}>Failures recorded: {v.progress.failureCount}</Text>
      </Card>
      <Banner tone={others.length ? 'warning' : 'success'} message={completionMessage(others.length)} />
      {[...groups].map(([code, issues]) => (
        <Card key={code} style={{ gap: spacing.xs }}>
          <Text style={styles.section}>{code ? sectionName(code) : 'Visit'}</Text>
          {issues.map((i) => (
            <Text key={`${i.kind}-${i.refId}`} style={styles.issue}>
              • {i.label} — {ISSUE_TEXT[i.kind]}
            </Text>
          ))}
        </Card>
      ))}

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.section}>Technician signature</Text>
        {v.signature ? (
          <Text style={styles.meta}>
            Signed by {v.signature.signedName ?? 'you'} at {v.signature.signedAt.slice(0, 16).replace('T', ' ')}. Any later change removes the signature.
          </Text>
        ) : (
          <>
            <Text style={styles.meta}>Sign last: changing an answer afterwards removes the signature.</Text>
            <View onLayout={(e) => setPadWidth(Math.floor(e.nativeEvent.layout.width))}>
              <SignaturePad strokes={strokes} onChange={setStrokes} height={PAD_HEIGHT} />
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Clear" variant="outline" onPress={() => setStrokes([])} disabled={busy} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Save signature" onPress={() => void sign()} loading={busy} disabled={!strokes.length} />
              </View>
            </View>
          </>
        )}
      </Card>

      {message ? <Banner tone="danger" message={message} /> : null}
      <PrimaryButton title="Complete PM" onPress={() => void complete()} loading={busy} disabled={others.length > 0 || needsSignature} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 80 },
  section: { fontSize: 17, fontWeight: '700', color: colors.text },
  issue: { fontSize: 15, color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  row: { flexDirection: 'row', gap: spacing.md },
});

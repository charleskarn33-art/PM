import { ISSUE_LABELS, submissionMessage } from '@ipt/shared';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, LoadingView, PrimaryButton } from '@/components/ui';
import { usePmVisitContext } from '@/pm/context';
import { ProgressBar, TextAnswer } from '@/pm/controls';
import { colors, spacing } from '@/theme';

export default function SubmitScreen() {
  const pm = usePmVisitContext();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (pm.loading || !pm.visit) return <LoadingView />;

  const bySection = new Map<string, typeof pm.issues>();
  for (const i of pm.issues) bySection.set(i.sectionCode, [...(bySection.get(i.sectionCode) ?? []), i]);
  const sectionName = (code: string) => pm.sections.find((s) => s.code === code)?.name ?? code;

  async function submit() {
    setBusy(true);
    setError(null);
    const message = await pm.submit();
    setBusy(false);
    if (message) setError(message);
    else router.replace({ pathname: '/pm', params: { submitted: '1' } });
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Review & submit' }} />
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <ProgressBar pct={pm.progress.completionPct} />
          <Text style={styles.meta}>Failures recorded: {pm.progress.failureCount}</Text>
        </Card>
        <Banner tone={pm.issues.length ? 'warning' : 'success'} message={submissionMessage(pm.issues.length)} />
        {[...bySection].map(([code, issues]) => (
          <Card key={code} style={{ gap: spacing.xs }}>
            <Text style={styles.section}>{sectionName(code)}</Text>
            {issues.map((i) => (
              <Text key={`${i.refId}-${i.issue}`} style={styles.issue}>
                • {i.label} — {ISSUE_LABELS[i.issue]}
              </Text>
            ))}
          </Card>
        ))}
        <Card style={{ gap: spacing.sm }}>
          <Text style={styles.section}>Overall comments</Text>
          <TextAnswer
            label="Overall comments"
            value={pm.visit.overall_comments}
            multiline
            disabled={!pm.editable}
            onCommit={(text) => {
              void pm.saveOverallComments(text ?? '').then((e) => e && setError(e));
            }}
          />
        </Card>
        {error ? <Banner tone="danger" message={error} /> : null}
        <View style={{ gap: spacing.sm }}>
          <PrimaryButton title="Submit PM" onPress={() => void submit()} loading={busy} />
          <Text style={styles.meta}>After submission the PM is locked until your supervisor approves or returns it.</Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: spacing.xs },
  section: { fontSize: 17, fontWeight: '700', color: colors.text },
  issue: { fontSize: 15, color: colors.text },
});

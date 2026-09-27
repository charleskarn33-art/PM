import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { ChoiceChips } from '@/components/answer-controls';
import { Banner, Card, PrimaryButton } from '@/components/ui';
import { errorMessage } from '@/lib/api/errors';
import { sessionClient } from '@/lib/api/session';
import type { Severity } from '@/lib/api/types';
import { colors, radius, spacing, touchTarget } from '@/theme';

const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const CATEGORIES = { Generator: 'GENERATOR', 'DC system': 'DC_SYSTEM', Battery: 'BATTERY', Solar: 'SOLAR', 'Non-technical': 'NON_TECHNICAL', Earthing: 'EARTHING', Other: 'OTHER' } as const;
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** A failure found on site outside a PM checklist (needs a connection to send). */
export default function ReportFailureScreen() {
  const { siteId, siteName } = useLocalSearchParams<{ siteId: string; siteName?: string }>();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('MEDIUM');
  const [category, setCategory] = useState<keyof typeof CATEGORIES | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per report: a retry after a lost answer does not create a second failure.
  const id = useRef(randomUUID());

  async function submit() {
    if (!sessionClient) return;
    setBusy(true);
    setError(null);
    try {
      await sessionClient.request('/failures', {
        method: 'POST',
        body: { id: id.current, siteId, title: title.trim(), description: description.trim() || null, severity, ...(category ? { category: CATEGORIES[category] } : {}) },
      });
      router.back();
    } catch (e) {
      setError(errorMessage(e, 'report the failure'));
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {siteName ? <Text style={styles.site}>{siteName}</Text> : null}
      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.label}>What is wrong *</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={500} placeholder="e.g. Rectifier module 2 not working" placeholderTextColor={colors.textMuted} accessibilityLabel="What is wrong" />
        <Text style={styles.label}>Details</Text>
        <TextInput style={[styles.input, styles.multi]} value={description} onChangeText={setDescription} multiline maxLength={4000} placeholder="What you saw, what you checked" placeholderTextColor={colors.textMuted} accessibilityLabel="Details" />
        <Text style={styles.label}>Severity</Text>
        <ChoiceChips options={SEVERITIES.map(label)} selected={[label(severity)]} onChange={(o) => o[0] && setSeverity(o[0].toUpperCase() as Severity)} />
        <Text style={styles.label}>Area</Text>
        <ChoiceChips options={Object.keys(CATEGORIES)} selected={category ? [category] : []} onChange={(o) => setCategory((o[0] as keyof typeof CATEGORIES | undefined) ?? null)} />
      </Card>
      {error ? <Banner tone="danger" message={error} /> : null}
      <PrimaryButton title="Report failure" loading={busy} disabled={!title.trim()} onPress={() => void submit()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 80 },
  site: { fontSize: 20, fontWeight: '800', color: colors.text },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  input: { minHeight: touchTarget, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 17, color: colors.text, backgroundColor: colors.white },
  multi: { minHeight: touchTarget * 2, paddingVertical: spacing.md, textAlignVertical: 'top' },
});

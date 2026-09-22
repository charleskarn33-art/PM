import { commentRequired, isFailure, photoRequired } from '@ipt/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, LoadingView, PrimaryButton } from '@/components/ui';
import { usePmVisitContext } from '@/pm/context';
import { ChoiceChips, NumberInput, Notice, SaveBadge, TextAnswer, YesNoNaButtons } from '@/pm/controls';
import type { Item } from '@/pm/model';
import { colors, spacing } from '@/theme';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function SectionScreen() {
  const { sectionId } = useLocalSearchParams<{ sectionId: string }>();
  const pm = usePmVisitContext();
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  if (pm.loading) return <LoadingView />;
  const section = pm.sections.find((s) => s.id === sectionId);
  if (!section || !pm.visit) return <Banner tone="danger" message="Section not found." />;

  const fields = pm.fields.filter((f) => f.section_id === section.id);
  const items = pm.items.filter((i) => i.section_id === section.id);
  const disabled = !pm.editable;
  const p = pm.progress.sections.find((s) => s.code === section.code);

  function renderAnswer(item: Item) {
    const r = pm.responses.get(item.id);
    switch (item.response_type) {
      case 'YES_NO_NA':
        return <YesNoNaButtons item={item} value={r?.answer ?? null} disabled={disabled} onChange={(answer) => pm.setResponse(item.id, { answer })} />;
      case 'NUMBER':
        return (
          <NumberInput
            label={item.prompt}
            value={r?.numeric_value ?? null}
            unit={item.unit}
            min={item.min_value}
            max={item.max_value}
            integer={Boolean((item.metadata as { integer?: boolean }).integer)}
            disabled={disabled}
            onCommit={(numeric_value) => pm.setResponse(item.id, { numeric_value, answer: null })}
          />
        );
      case 'SELECT':
      case 'MULTI_SELECT':
        return (
          <ChoiceChips
            options={item.options as string[]}
            multiple={item.response_type === 'MULTI_SELECT'}
            selected={item.response_type === 'SELECT' ? (r?.text_value ? [r.text_value] : []) : (r?.selected_options ?? [])}
            disabled={disabled}
            onChange={(next) =>
              pm.setResponse(
                item.id,
                item.response_type === 'SELECT' ? { text_value: next[0] ?? null } : { selected_options: next.length ? next : null },
              )
            }
          />
        );
      case 'DATE':
        return (
          <View style={{ gap: spacing.sm }}>
            <TextAnswer label={item.prompt} value={r?.date_value ?? null} placeholder="YYYY-MM-DD" disabled={disabled} onCommit={(date_value) => pm.setResponse(item.id, { date_value })} />
            <PrimaryButton title="Today" variant="outline" onPress={() => pm.setResponse(item.id, { date_value: todayIso() })} />
          </View>
        );
      case 'DATETIME':
        return <PrimaryButton title={r?.datetime_value ? new Date(r.datetime_value).toLocaleString() : 'Record current time'} variant="outline" onPress={() => pm.setResponse(item.id, { datetime_value: new Date().toISOString() })} />;
      case 'PHOTO':
        return <Notice tone="info" text="Photo capture is added in Phase 5." />;
      default:
        return <TextAnswer label={item.prompt} value={r?.text_value ?? null} disabled={disabled} onCommit={(text_value) => pm.setResponse(item.id, { text_value })} />;
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: section.name }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.meta}>
            {p?.done ?? 0} of {p?.required ?? 0} required done{p?.failures ? ` · ${p.failures} failure(s)` : ''}
          </Text>
          {pm.saveError ? (
            <View style={{ gap: spacing.sm }}>
              <Banner tone="danger" message={pm.saveError} />
              <PrimaryButton title="Retry" variant="outline" onPress={pm.retryFailed} />
            </View>
          ) : null}

          {fields.length > 0 ? (
            <Card style={{ gap: spacing.md }}>
              <Text style={styles.groupTitle}>Readings</Text>
              {fields.map((f) => {
                const r = pm.readings.get(f.id);
                return (
                  <View key={f.id} style={{ gap: spacing.xs }}>
                    <View style={styles.labelRow}>
                      <Text style={styles.label}>
                        {f.label}
                        {f.is_required ? '' : ' (optional)'}
                      </Text>
                      <SaveBadge state={pm.saveState[f.id]} />
                    </View>
                    {f.value_type === 'NUMBER' ? (
                      <NumberInput
                        label={f.label}
                        value={r?.numeric_value ?? null}
                        unit={f.unit}
                        min={f.min_value}
                        max={f.max_value}
                        integer={f.is_integer}
                        disabled={disabled}
                        onCommit={(numeric_value) => pm.setReading(f.id, { numeric_value })}
                      />
                    ) : f.value_type === 'SELECT' ? (
                      <ChoiceChips
                        options={f.options as string[]}
                        selected={r?.text_value ? [r.text_value] : []}
                        disabled={disabled}
                        onChange={(next) => pm.setReading(f.id, { text_value: next[0] ?? null })}
                      />
                    ) : (
                      <TextAnswer label={f.label} value={r?.text_value ?? null} disabled={disabled} onCommit={(text_value) => pm.setReading(f.id, { text_value })} />
                    )}
                  </View>
                );
              })}
            </Card>
          ) : null}

          {items.map((item) => {
            const r = pm.responses.get(item.id);
            const failed = isFailure(item, r?.answer);
            const needsComment = commentRequired(item, r);
            const needsPhoto = pm.enforcePhotos && photoRequired(item, r) && !pm.photoCounts[item.id];
            const showComment = needsComment || Boolean(r?.comment) || openComments.has(item.id);
            return (
              <Card key={item.id} style={[{ gap: spacing.sm }, failed && styles.failedCard]}>
                <View style={styles.labelRow}>
                  <Text style={[styles.label, { flex: 1 }]}>
                    {item.prompt}
                    {item.is_required ? '' : ' (optional)'}
                  </Text>
                  <SaveBadge state={pm.saveState[item.id]} />
                </View>
                {item.help_text ? <Text style={styles.meta}>{item.help_text}</Text> : null}
                {renderAnswer(item)}
                {failed ? <Notice tone="danger" text={`Failure recorded (${item.failure_severity.toLowerCase()} severity).`} /> : null}
                {needsPhoto ? (
                  <Notice tone="warning" text={`Photo required${item.photo_instructions ? `: ${item.photo_instructions}` : ''}. Camera capture is added in Phase 5.`} />
                ) : null}
                {showComment ? (
                  <View style={{ gap: spacing.xs }}>
                    <Text style={styles.meta}>{needsComment ? 'Comment / action taken (required)' : 'Comment'}</Text>
                    <TextAnswer label={`Comment for ${item.prompt}`} value={r?.comment ?? null} multiline disabled={disabled} onCommit={(comment) => pm.setResponse(item.id, { comment })} />
                  </View>
                ) : disabled ? null : (
                  <Pressable accessibilityRole="button" onPress={() => setOpenComments((s) => new Set(s).add(item.id))} style={styles.addComment}>
                    <Text style={styles.addCommentText}>+ Add comment</Text>
                  </Pressable>
                )}
              </Card>
            );
          })}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  meta: { fontSize: 14, color: colors.textMuted },
  groupTitle: { fontSize: 16, fontWeight: '800', color: colors.text, textTransform: 'uppercase' },
  labelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, justifyContent: 'space-between' },
  label: { fontSize: 17, fontWeight: '600', color: colors.text },
  failedCard: { borderColor: '#b91c1c', borderWidth: 2 },
  addComment: { minHeight: 40, justifyContent: 'center' },
  addCommentText: { color: '#1d4ed8', fontSize: 15, fontWeight: '600' },
});

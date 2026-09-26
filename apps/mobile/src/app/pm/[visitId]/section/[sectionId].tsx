import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AnswerButtons, ChoiceChips, DateField, Notice, NumberField, TextField } from '@/components/answer-controls';
import { Banner, Card, LoadingView } from '@/components/ui';
import type { ChecklistItem } from '@/lib/api/types';
import { ISSUE_TEXT, needsComment, needsPhoto } from '@/pm/model';
import { useVisit } from '@/pm/visit-context';
import { colors, radius, spacing, toneColors } from '@/theme';

/** One section: its readings, then its questions (every answer type), with photo evidence. */
export default function SectionScreen() {
  const { sectionId } = useLocalSearchParams<{ sectionId: string }>();
  const pm = useVisit();
  const router = useRouter();
  if (pm.loading) return <LoadingView />;
  const v = pm.visit;
  const section = v?.sections.find((s) => s.id === sectionId);
  if (!v || !section) return <Banner tone="danger" message="Section not found." />;
  const disabled = !pm.editable;
  const photosFor = (itemId: string) => v.photos.filter((p) => p.checklistItemId === itemId);
  const issuesFor = (id: string) => v.issues.filter((i) => i.refId === id);

  const saveState = pm.syncStatus === 'SYNCED' ? 'Synced' : pm.syncStatus === 'SYNCING' ? 'Syncing…' : pm.syncStatus === 'SYNC_ERROR' ? 'Sync error' : 'Saved on phone';

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: section.name, headerRight: () => <Text style={styles.saveState}>{saveState}</Text> }} />
      {pm.saveError ? <Banner tone="danger" message={pm.saveError} /> : null}

      {section.readingFields.length ? <Text style={styles.heading}>Readings</Text> : null}
      {section.readingFields.map((f) => {
        const r = pm.readings.get(f.id);
        return (
          <Card key={f.id} style={{ gap: spacing.sm }}>
            <Text style={styles.prompt}>
              {f.label}
              {f.isRequired ? ' *' : ''}
            </Text>
            {f.helpText ? <Text style={styles.help}>{f.helpText}</Text> : null}
            {f.valueType === 'NUMBER' ? (
              <NumberField label={f.label} value={r?.numericValue ?? null} unit={f.unit} minValue={f.minValue} maxValue={f.maxValue} isInteger={f.isInteger} disabled={disabled} serverError={pm.fieldErrors.get(f.id)} onCommit={(n) => pm.setReading(f, n)} />
            ) : f.valueType === 'SELECT' ? (
              <ChoiceChips options={f.options} selected={r?.textValue ? [r.textValue] : []} disabled={disabled} onChange={(o) => pm.setReading(f, o[0] ?? null)} />
            ) : (
              <TextField label={f.label} value={r?.textValue ?? null} disabled={disabled} serverError={pm.fieldErrors.get(f.id)} onCommit={(t) => pm.setReading(f, t)} />
            )}
            {issuesFor(f.id).map((i) => (
              <Notice key={i.kind} tone="warning" text={ISSUE_TEXT[i.kind]} />
            ))}
          </Card>
        );
      })}

      {section.items.length ? <Text style={styles.heading}>Checklist</Text> : null}
      {section.items.map((item) => (
        <Question key={item.id} item={item} photos={photosFor(item.id).length} disabled={disabled} onPhoto={() => router.push({ pathname: `/pm/${v.id}/camera`, params: { itemId: item.id, caption: item.photoInstructions ?? item.prompt } })} />
      ))}
    </ScrollView>
  );
}

function Question({ item, photos, disabled, onPhoto }: { item: ChecklistItem; photos: number; disabled: boolean; onPhoto: () => void }) {
  const pm = useVisit();
  const r = pm.responses.get(item.id);
  const issues = pm.visit?.issues.filter((i) => i.refId === item.id) ?? [];
  const failure = r?.isFailure ?? false;
  const wantsComment = needsComment(item, r);
  const wantsPhoto = needsPhoto(item, r);
  const set = (patch: Parameters<typeof pm.setResponse>[1]) => pm.setResponse(item, patch);
  const [addingComment, setAddingComment] = useState(false);

  return (
    <Card style={[{ gap: spacing.sm }, failure && { borderColor: toneColors.danger.fg, borderWidth: 2 }]}>
      <Text style={styles.prompt}>
        {item.prompt}
        {item.isRequired && item.responseType !== 'PHOTO' ? ' *' : ''}
      </Text>
      {item.helpText ? <Text style={styles.help}>{item.helpText}</Text> : null}

      {item.responseType === 'YES_NO_NA' ? (
        <AnswerButtons value={r?.answer ?? null} allowNa={item.allowNotApplicable} failureAnswer={item.failureOnAnswer} disabled={disabled} onChange={(answer) => set({ answer })} />
      ) : item.responseType === 'NUMBER' ? (
        <NumberField label={item.prompt} value={r?.numericValue ?? null} unit={item.unit} minValue={item.minValue} maxValue={item.maxValue} isInteger={item.isInteger} disabled={disabled} serverError={pm.fieldErrors.get(item.id)} onCommit={(numericValue) => set({ numericValue, answer: null })} />
      ) : item.responseType === 'TEXT' ? (
        <TextField label={item.prompt} value={r?.textValue ?? null} multiline disabled={disabled} serverError={pm.fieldErrors.get(item.id)} onCommit={(textValue) => set({ textValue, answer: null })} />
      ) : item.responseType === 'SELECT' ? (
        <ChoiceChips options={item.options} selected={r?.textValue ? [r.textValue] : []} disabled={disabled} onChange={(o) => set({ textValue: o[0] ?? null, answer: null })} />
      ) : item.responseType === 'MULTI_SELECT' ? (
        <ChoiceChips options={item.options} multiple selected={r?.selectedOptions ?? []} disabled={disabled} onChange={(o) => set({ selectedOptions: o.length ? o : null, answer: null })} />
      ) : item.responseType === 'DATE' ? (
        <DateField label={item.prompt} value={r?.dateValue ?? null} withTime={false} disabled={disabled} onCommit={(dateValue) => set({ dateValue, answer: null })} />
      ) : item.responseType === 'DATETIME' ? (
        <DateField label={item.prompt} value={r?.datetimeValue ?? null} withTime disabled={disabled} onCommit={(datetimeValue) => set({ datetimeValue, answer: null })} />
      ) : null}

      {item.responseType !== 'YES_NO_NA' && item.allowNotApplicable ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: r?.answer === 'NA', disabled }}
          disabled={disabled}
          onPress={() =>
            set(r?.answer === 'NA' ? { answer: null } : { answer: 'NA', numericValue: null, textValue: null, selectedOptions: null, dateValue: null, datetimeValue: null })
          }
          style={styles.naToggle}
        >
          <Text style={styles.naText}>{r?.answer === 'NA' ? '☑' : '☐'} Not applicable</Text>
        </Pressable>
      ) : null}

      {failure ? <Notice tone="danger" text="Failure recorded" /> : null}
      {wantsComment || r?.comment || addingComment ? (
        <TextField label={`Comment for ${item.prompt}`} value={r?.comment ?? null} multiline disabled={disabled} placeholder={wantsComment ? 'Comment required' : 'Comment'} onCommit={(comment) => set({ comment })} />
      ) : !disabled ? (
        <Pressable accessibilityRole="button" onPress={() => setAddingComment(true)} style={styles.naToggle}>
          <Text style={styles.link}>+ Add comment</Text>
        </Pressable>
      ) : null}

      {wantsPhoto || photos > 0 || item.responseType === 'PHOTO' ? (
        <View style={styles.photoRow}>
          <Text style={styles.help}>
            {photos} photo{photos === 1 ? '' : 's'}
            {item.photoInstructions ? ` · ${item.photoInstructions}` : ''}
          </Text>
          {!disabled ? (
            <Pressable accessibilityRole="button" onPress={onPhoto} style={styles.photoButton}>
              <Text style={styles.photoButtonText}>📷 Take photo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {issues.map((i) => (
        <Notice key={i.kind} tone="warning" text={ISSUE_TEXT[i.kind]} />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 80 },
  heading: { fontSize: 18, fontWeight: '800', color: colors.text },
  prompt: { fontSize: 17, fontWeight: '700', color: colors.text },
  help: { fontSize: 14, color: colors.textMuted },
  saveState: { color: colors.white, fontSize: 14, marginRight: spacing.md },
  naToggle: { paddingVertical: spacing.sm },
  naText: { fontSize: 16, color: colors.text },
  link: { fontSize: 16, color: '#1d4ed8', fontWeight: '600' },
  photoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  photoButton: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.navy, justifyContent: 'center' },
  photoButtonText: { color: colors.white, fontWeight: '700', fontSize: 16 },
});

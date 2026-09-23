import { isFailure, numberError, type Enums } from '@ipt/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, toneColors, touchTarget } from '@/theme';
import { parseNumberInput, progressBarText, unitSuffix, type Item, type ResponseRow } from './model';
import type { SaveState } from './use-pm-visit';

type Answer = Enums<'yes_no_na'>;

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`PM progress ${progressBarText(pct)}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
      </View>
      <Text style={styles.progressText}>PM Progress {Math.round(pct)}%</Text>
    </View>
  );
}

export function YesNoNaButtons({
  item,
  value,
  onChange,
  disabled,
}: {
  item: Item;
  value: Answer | null;
  onChange: (a: Answer) => void;
  disabled?: boolean;
}) {
  const options: Answer[] = item.allow_not_applicable ? ['YES', 'NO', 'N/A'] : ['YES', 'NO'];
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {options.map((a) => {
        const selected = value === a;
        const tone = a === 'N/A' ? toneColors.neutral : isFailure(item, a) ? toneColors.danger : toneColors.success;
        return (
          <Pressable
            key={a}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${a}${isFailure(item, a) ? ', records a failure' : ''}`}
            disabled={disabled}
            onPress={() => onChange(a)}
            style={[styles.answer, { borderColor: tone.fg }, selected && { backgroundColor: tone.fg }]}
          >
            <Text style={[styles.answerText, { color: selected ? colors.white : tone.fg }]}>{a}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function NumberInput({
  label,
  value,
  unit,
  min,
  max,
  integer,
  onCommit,
  disabled,
}: {
  label: string;
  value: number | null;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  integer?: boolean;
  onCommit: (v: number | null) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const parsed = parseNumberInput(text);
    if (parsed.error) return setError(parsed.error);
    if (parsed.value != null) {
      const e = numberError(label, parsed.value, { min, max, integer });
      if (e) return setError(e);
    }
    setError(null);
    if (parsed.value !== value) onCommit(parsed.value);
  }

  return (
    <View>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }, error && { borderColor: toneColors.danger.fg }]}
          value={text}
          onChangeText={setText}
          onEndEditing={commit}
          onBlur={commit}
          keyboardType={integer ? 'number-pad' : 'decimal-pad'}
          editable={!disabled}
          accessibilityLabel={`${label}${unitSuffix(unit)}`}
          returnKeyType="done"
        />
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {min != null || max != null ? (
        <Text style={styles.hint}>
          {min != null && max != null ? `${min} – ${max}` : min != null ? `≥ ${min}` : `≤ ${max}`}
          {unitSuffix(unit)}
        </Text>
      ) : null}
    </View>
  );
}

export function TextAnswer({
  label,
  value,
  onCommit,
  disabled,
  multiline,
  placeholder,
}: {
  label: string;
  value: string | null;
  onCommit: (v: string | null) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value ?? '');
  const commit = () => {
    const next = text.trim() === '' ? null : text.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <TextInput
      style={[styles.input, multiline && styles.multiline]}
      value={text}
      onChangeText={setText}
      onEndEditing={commit}
      onBlur={commit}
      editable={!disabled}
      multiline={multiline}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      accessibilityLabel={label}
    />
  );
}

export function ChoiceChips({
  options,
  selected,
  multiple,
  onChange,
  disabled,
}: {
  options: string[];
  selected: string[];
  multiple?: boolean;
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, { flexWrap: 'wrap' }]}>
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <Pressable
            key={o}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(multiple ? (on ? selected.filter((s) => s !== o) : [...selected, o]) : [o])}
            style={[styles.chip, on && { backgroundColor: colors.navy, borderColor: colors.navy }]}
          >
            <Text style={[styles.chipText, on && { color: colors.white }]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SaveBadge({ state }: { state?: SaveState }) {
  if (!state) return null;
  const map = {
    pending: ['Saved on phone', toneColors.info],
    sent: ['Sent', toneColors.success],
    error: ['Refused by server', toneColors.danger],
  } as const;
  const [label, tone] = map[state];
  return <Text style={[styles.save, { color: tone.fg }]}>{label}</Text>;
}

export function Notice({ tone, text }: { tone: keyof typeof toneColors; text: string }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.notice, { backgroundColor: c.bg }]}>
      <Text style={{ color: c.fg, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

export function answerOf(r: ResponseRow | undefined): Answer | null {
  return r?.answer ?? null;
}

const styles = StyleSheet.create({
  track: { height: 14, borderRadius: 7, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#15803d' },
  progressText: { marginTop: spacing.xs, fontSize: 14, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  answer: {
    flex: 1,
    minHeight: touchTarget,
    borderWidth: 2,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerText: { fontSize: 18, fontWeight: '800' },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    fontSize: 18,
    color: colors.text,
    backgroundColor: colors.white,
  },
  multiline: { minHeight: 96, paddingTop: spacing.md, textAlignVertical: 'top' },
  unit: { fontSize: 18, fontWeight: '700', color: colors.textMuted, minWidth: 36 },
  error: { color: toneColors.danger.fg, fontSize: 14, marginTop: spacing.xs },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  chip: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  chipText: { fontSize: 16, fontWeight: '600', color: colors.text },
  save: { fontSize: 12, fontWeight: '700' },
  notice: { borderRadius: radius.sm, padding: spacing.sm },
});

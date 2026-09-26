import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Answer } from '@/lib/api/types';
import { answerLabel, limitsHint, numberProblem, parseNumberInput } from '@/pm/model';
import { colors, radius, spacing, toneColors, touchTarget } from '@/theme';

export function ProgressBar({ pct }: { pct: number }) {
  const shown = Math.floor(pct);
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`PM progress ${shown}%`} accessibilityValue={{ min: 0, max: 100, now: shown }}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
      </View>
      <Text style={styles.progressText}>PM progress {shown}%</Text>
    </View>
  );
}

/** Large Yes / No / N/A buttons; the failure answer is shown in red. */
export function AnswerButtons({
  value,
  allowNa,
  failureAnswer,
  onChange,
  disabled,
}: {
  value: Answer | null;
  allowNa: boolean;
  failureAnswer: 'YES' | 'NO' | null;
  onChange: (a: Answer | null) => void;
  disabled?: boolean;
}) {
  const options: Answer[] = allowNa ? ['YES', 'NO', 'NA'] : ['YES', 'NO'];
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {options.map((a) => {
        const selected = value === a;
        const tone = a === 'NA' ? toneColors.neutral : a === failureAnswer ? toneColors.danger : toneColors.success;
        return (
          <Pressable
            key={a}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${answerLabel(a)}${a === failureAnswer ? ', records a failure' : ''}`}
            disabled={disabled}
            onPress={() => onChange(selected ? null : a)}
            style={[styles.answer, { borderColor: tone.fg }, selected && { backgroundColor: tone.fg }]}
          >
            <Text style={[styles.answerText, { color: selected ? colors.white : tone.fg }]}>{answerLabel(a)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A number, checked against the limits configured for it (none otherwise); saved when the field is left. */
export function NumberField({
  label,
  value,
  unit,
  minValue,
  maxValue,
  isInteger,
  onCommit,
  disabled,
  serverError,
}: {
  label: string;
  value: number | null;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  isInteger: boolean;
  onCommit: (v: number | null) => void;
  disabled?: boolean;
  serverError?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  // The stored value changed (e.g. the server's copy arrived): show it.
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(value == null ? '' : String(value));
  }

  function commit() {
    const parsed = parseNumberInput(text);
    if (parsed.error) return setError(parsed.error);
    const problem = parsed.value == null ? null : numberProblem(parsed.value, { minValue, maxValue, isInteger });
    if (problem) return setError(problem);
    setError(null);
    if (parsed.value !== value) onCommit(parsed.value);
  }

  const hint = limitsHint({ minValue, maxValue, unit });
  const shownError = error ?? serverError;
  return (
    <View>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }, shownError ? { borderColor: toneColors.danger.fg } : null]}
          value={text}
          onChangeText={setText}
          onEndEditing={commit}
          onBlur={commit}
          keyboardType={isInteger ? 'number-pad' : 'decimal-pad'}
          editable={!disabled}
          accessibilityLabel={`${label}${unit ? ` in ${unit}` : ''}`}
          returnKeyType="done"
        />
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      {shownError ? <Text style={styles.error}>{shownError}</Text> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function TextField({
  label,
  value,
  onCommit,
  disabled,
  multiline,
  placeholder,
  serverError,
}: {
  label: string;
  value: string | null;
  onCommit: (v: string | null) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
  serverError?: string;
}) {
  const [text, setText] = useState(value ?? '');
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(value ?? '');
  }
  const commit = () => {
    const next = text.trim() === '' ? null : text.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <View>
      <TextInput
        style={[styles.input, multiline && styles.multiline, serverError ? { borderColor: toneColors.danger.fg } : null]}
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
      {serverError ? <Text style={styles.error}>{serverError}</Text> : null}
    </View>
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
            onPress={() => onChange(multiple ? (on ? selected.filter((s) => s !== o) : [...selected, o]) : on ? [] : [o])}
            style={[styles.chip, on && { backgroundColor: colors.navy, borderColor: colors.navy }]}
          >
            <Text style={[styles.chipText, on && { color: colors.white }]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A date (YYYY-MM-DD) or date and time, typed; "Now" / "Today" fills it in. */
export function DateField({
  label,
  value,
  withTime,
  onCommit,
  disabled,
}: {
  label: string;
  value: string | null;
  withTime: boolean;
  onCommit: (v: string | null) => void;
  disabled?: boolean;
}) {
  const shown = value ? (withTime ? value.slice(0, 16).replace('T', ' ') : value) : '';
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const [lastShown, setLastShown] = useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    setText(shown);
  }
  const now = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
  };
  function commit(t = text) {
    const v = t.trim();
    if (!v) {
      setError(null);
      if (value) onCommit(null);
      return;
    }
    const ok = withTime ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v) : /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!ok) return setError(withTime ? 'Use YYYY-MM-DD HH:MM' : 'Use YYYY-MM-DD');
    setError(null);
    // Date and time are local to the phone; the server stores the instant.
    onCommit(withTime ? new Date(v.replace(' ', 'T')).toISOString() : v);
  }
  return (
    <View>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }, error ? { borderColor: toneColors.danger.fg } : null]}
          value={text}
          onChangeText={setText}
          onEndEditing={() => commit()}
          editable={!disabled}
          placeholder={withTime ? 'YYYY-MM-DD HH:MM' : 'YYYY-MM-DD'}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
        />
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => {
            const t = now();
            setText(t);
            commit(t);
          }}
          style={styles.chip}
        >
          <Text style={styles.chipText}>{withTime ? 'Now' : 'Today'}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function Notice({ tone, text }: { tone: keyof typeof toneColors; text: string }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.notice, { backgroundColor: c.bg }]}>
      <Text style={{ color: c.fg, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 14, borderRadius: 7, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#15803d' },
  progressText: { marginTop: spacing.xs, fontSize: 14, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  answer: { flex: 1, minHeight: touchTarget, borderWidth: 2, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
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
  notice: { borderRadius: radius.sm, padding: spacing.sm },
});

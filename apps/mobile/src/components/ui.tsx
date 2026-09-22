import { humanizeStatus, type StatusTone } from '@ipt/shared';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing, toneColors, touchTarget } from '@/theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function StatusPill({ status, tone }: { status: string; tone: StatusTone }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]}>{humanizeStatus(status)}</Text>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  loading,
  variant = 'primary',
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'outline';
  accessibilityLabel?: string;
}) {
  const outline = variant === 'outline';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: loading, busy: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        outline ? styles.buttonOutline : styles.buttonPrimary,
        (pressed || loading) && { opacity: 0.75 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={outline ? colors.navy : colors.white} />
      ) : (
        <Text style={[styles.buttonText, outline && { color: colors.navy }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Banner({ tone, message }: { tone: StatusTone; message: string }) {
  const c = toneColors[tone];
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: c.bg, borderColor: c.fg }]}>
      <Text style={{ color: c.fg, fontSize: 15 }}>{message}</Text>
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </View>
  );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.empty} accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.navy} />
      <Text style={[styles.emptyMessage, { marginTop: spacing.md }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 13, fontWeight: '600' },
  button: {
    minHeight: touchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  buttonPrimary: { backgroundColor: colors.red },
  buttonOutline: { borderWidth: 2, borderColor: colors.navy, backgroundColor: colors.white },
  buttonText: { color: colors.white, fontSize: 18, fontWeight: '700' },
  banner: { borderWidth: 1, borderRadius: radius.sm, padding: spacing.md },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, flexGrow: 1 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyMessage: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
});

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { colors, radius, spacing, touchTarget } from '@/theme';

const MIN_LENGTH = 12;

/** Shown after signing in with a temporary password: the user chooses their own before anything else. */
export default function ChangePasswordScreen() {
  const { profile, changePassword, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (!current) return setError('Enter your temporary password.');
    if (next.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters for the new password.`);
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    setError(null);
    const message = await changePassword(current, next);
    setBusy(false);
    if (message) setError(message);
  }

  const field = (label: string, value: string, onChange: (v: string) => void, autoComplete: 'current-password' | 'new-password') => (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={autoComplete}
        textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
        accessibilityLabel={label}
      />
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <Text style={styles.title}>Choose your password</Text>
            <Text style={styles.help}>
              {profile?.email ? `You signed in as ${profile.email} with a temporary password. ` : ''}Choose your own to continue.
            </Text>
            {error ? <Banner tone="danger" message={error} /> : null}
            {field('Temporary password', current, setCurrent, 'current-password')}
            {field('New password (at least 12 characters)', next, setNext, 'new-password')}
            {field('Repeat the new password', confirm, setConfirm, 'new-password')}
            <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
              <PrimaryButton title="Save password" onPress={onSubmit} loading={busy} />
              <PrimaryButton title="Sign out" variant="outline" onPress={() => void signOut()} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  form: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  help: { fontSize: 15, color: colors.textMuted, marginBottom: spacing.sm },
  label: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
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
});

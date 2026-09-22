import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { colors, radius, spacing, touchTarget } from '@/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (!email.trim() || !password) {
      setError('Enter your email address and password.');
      return;
    }
    setBusy(true);
    setError(null);
    const message = await signIn(email, password);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>⚡</Text>
            </View>
            <Text style={styles.title}>IPT PowerTech</Text>
            <Text style={styles.subtitle}>Preventive Maintenance · Field App</Text>
          </View>

          <View style={styles.form}>
            {error ? <Banner tone="danger" message={error} /> : null}
            <Text style={styles.label}>Email address</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              accessibilityLabel="Email address"
              returnKeyType="next"
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              accessibilityLabel="Password"
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />
            <View style={{ marginTop: spacing.lg }}>
              <PrimaryButton title="Sign in" onPress={onSubmit} loading={busy} />
            </View>
            <Text style={styles.help}>Accounts are created by your administrator.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 32, color: colors.white },
  title: { color: colors.white, fontSize: 26, fontWeight: '800', marginTop: spacing.md },
  subtitle: { color: '#c9d4e5', fontSize: 15, marginTop: spacing.xs },
  form: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
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
  help: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});

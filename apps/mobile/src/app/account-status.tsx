import { ROLE_LABELS } from '@ipt/shared';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

/** Shown to signed-in users who cannot use the field app (yet). */
export default function AccountStatusScreen() {
  const { profile, profileError, signOut, reloadProfile } = useAuth();

  let title = 'Loading your account…';
  let message = '';
  if (profileError) {
    title = 'Account unavailable';
    message = profileError;
  } else if (profile && !profile.is_active) {
    title = 'Account pending activation';
    message = 'Your account has not been activated yet. Ask a Super Admin to activate it and assign your role.';
  } else if (profile) {
    title = 'Use the web portal';
    message = `The field app is for Technicians and Maintenance users. Your role (${ROLE_LABELS[profile.role]}) uses the IPT PowerTech web portal.`;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {message ? <Banner tone={profileError ? 'danger' : 'warning'} message={message} /> : null}
        <PrimaryButton title="Retry" variant="outline" onPress={() => void reloadProfile()} />
        <PrimaryButton title="Sign out" onPress={() => void signOut()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
});

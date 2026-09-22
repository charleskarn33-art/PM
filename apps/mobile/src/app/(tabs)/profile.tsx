import { ROLE_LABELS } from '@ipt/shared';
import Constants from 'expo-constants';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Row label="Name" value={profile?.full_name || '—'} />
        <Row label="Email" value={profile?.email ?? '—'} />
        <Row label="Role" value={profile ? ROLE_LABELS[profile.role] : '—'} />
        <Row label="Phone" value={profile?.phone || '—'} />
      </Card>
      <Card>
        <Row label="Sync status" value="Online only (offline sync arrives in Phase 5)" />
        <Row label="App version" value={Constants.expoConfig?.version ?? 'unknown'} />
      </Card>
      <PrimaryButton title="Sign out" variant="outline" onPress={() => void signOut()} />
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  row: { paddingVertical: spacing.sm },
  label: { fontSize: 13, color: colors.textMuted, textTransform: 'uppercase', fontWeight: '600' },
  value: { fontSize: 17, color: colors.text, marginTop: 2 },
});

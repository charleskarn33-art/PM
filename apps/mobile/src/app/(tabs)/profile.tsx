import { ROLE_LABELS } from '@ipt/shared';
import Constants from 'expo-constants';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SyncBar } from '@/components/sync-bar';
import { Card, PrimaryButton } from '@/components/ui';
import { useOffline } from '@/offline/offline-provider';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  const { counts, lastSyncAt, packSavedAt, syncNow, syncing } = useOffline();
  const unsent = counts.pending + counts.syncing + counts.errors;
  const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : 'not yet');

  function confirmSignOut() {
    if (!unsent) return void signOut();
    // The changes stay on this phone for this account and are sent when it signs in again.
    Alert.alert('Changes not sent yet', `${unsent} change${unsent === 1 ? ' is' : 's are'} saved only on this phone. They are sent when you sign in again on this phone. Sign out anyway?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Row label="Name" value={profile?.full_name || '—'} />
        <Row label="Email" value={profile?.email ?? '—'} />
        <Row label="Role" value={profile?.role ? ROLE_LABELS[profile.role] : '—'} />
        <Row label="Phone" value={profile?.phone || '—'} />
      </Card>
      <SyncBar />
      <Card>
        <Row label="Changes waiting to sync" value={String(counts.pending + counts.syncing)} />
        <Row label="Changes refused by the server" value={String(counts.errors)} />
        <Row label="Last synced" value={when(lastSyncAt)} />
        <Row label="Offline data (sites, PMs, checklists) saved" value={when(packSavedAt)} />
        <PrimaryButton title="Sync now" variant="outline" loading={syncing} onPress={() => void syncNow()} />
      </Card>
      <Card>
        <Row label="App version" value={Constants.expoConfig?.version ?? 'unknown'} />
      </Card>
      <PrimaryButton title="Sign out" variant="outline" onPress={confirmSignOut} />
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
  row: { paddingVertical: spacing.sm, gap: spacing.xs },
  label: { fontSize: 14, color: colors.textMuted },
  value: { fontSize: 17, fontWeight: '600', color: colors.text },
});

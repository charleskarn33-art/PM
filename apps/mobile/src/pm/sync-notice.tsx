import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner } from '@/components/ui';
import { spacing } from '@/theme';
import type { PmVisitModel } from './use-pm-visit';

/** Explains save problems for this visit and links to the Sync status screen. */
export function VisitSyncNotice({ pm }: { pm: PmVisitModel }) {
  if (!pm.saveError && pm.syncErrors.length === 0) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {pm.saveError ? <Banner tone="danger" message={pm.saveError} /> : null}
      {pm.syncErrors.map((op) => (
        <Banner key={op.seq} tone="danger" message={`The server refused a change: ${op.last_error ?? 'unknown reason'}`} />
      ))}
      {pm.syncErrors.length > 0 ? (
        <Link href="/sync" asChild>
          <Pressable accessibilityRole="button" style={styles.link}>
            <Text style={styles.linkText}>Open Sync status to retry or discard</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1d4ed8', fontSize: 16, fontWeight: '600' },
});

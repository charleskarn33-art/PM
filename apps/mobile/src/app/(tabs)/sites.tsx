import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SavedCopyNote } from '@/components/sync-bar';
import { Banner, Card, EmptyState, LoadingView } from '@/components/ui';
import type { Site } from '@/lib/api/types';
import { useApi } from '@/lib/api/use-api';
import { useOffline } from '@/offline/offline-provider';
import { colors, radius, spacing, touchTarget } from '@/theme';

/** The sites the technician is assigned to (the server applies the scope). */
export default function SitesScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const sites = useApi<Site[]>(`/sites?pageSize=100${search ? `&q=${encodeURIComponent(search)}` : ''}`);
  const { pack } = useOffline();
  // Offline without a saved copy of this search: the sites in the field pack.
  const needle = search.toLowerCase();
  const fromPack = sites.error ? (pack?.sites.filter((s) => !needle || s.siteCode.toLowerCase().includes(needle) || s.siteName.toLowerCase().includes(needle)) ?? null) : null;
  const list = sites.data ?? fromPack;

  return (
    <View style={{ flex: 1 }}>
      <TextInput
        style={styles.search}
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => setSearch(q.trim())}
        placeholder="Search by site code or name"
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        accessibilityLabel="Search sites"
      />
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <SavedCopyNote savedAt={sites.savedAt} />
        {fromPack && !sites.data ? <Text style={styles.meta}>Offline: showing the sites saved on this phone.</Text> : null}
      </View>
      {sites.error && !list ? <Banner tone="danger" message={sites.error} /> : null}
      {sites.loading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={list ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={sites.refreshing} onRefresh={() => void sites.reload()} />}
          ListEmptyComponent={<EmptyState title="No sites" message={search ? 'No site matches your search.' : 'You are not assigned to any site yet.'} />}
          renderItem={({ item: s }) => (
            <Pressable accessibilityRole="button" onPress={() => router.push(`/site/${s.id}`)}>
              <Card>
                <Text style={styles.code}>{s.siteCode}</Text>
                <Text style={styles.name}>{s.siteName}</Text>
                <Text style={styles.meta}>{[s.region?.name, s.cluster?.name, s.county?.name].filter(Boolean).join(' · ')}</Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    margin: spacing.lg,
    marginBottom: 0,
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    fontSize: 17,
    backgroundColor: colors.white,
    color: colors.text,
  },
  code: { fontSize: 14, fontWeight: '700', color: colors.red },
  name: { fontSize: 18, fontWeight: '700', color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: spacing.xs },
});

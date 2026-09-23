import { Link } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, EmptyState, LoadingView, StatusPill } from '@/components/ui';
import { SyncBar } from '@/components/sync-bar';
import type { Site } from '@/offline/types';
import { useLocalQuery, useOffline } from '@/providers/offline-provider';
import { colors, spacing } from '@/theme';

export default function SitesScreen() {
  const { status, syncNow } = useOffline();
  const query = useLocalQuery(async (store) => ({ sites: await store.sites(), hasData: await store.hasData() }), 'sites');
  if (query.loading || !query.data) return <LoadingView label="Loading sites…" />;

  return (
    <FlatList
      data={[...query.data.sites].sort((a, b) => a.site_name.localeCompare(b.site_name))}
      keyExtractor={(s) => s.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          <SyncBar />
          {query.error ? <Banner tone="danger" message={query.error} /> : null}
        </View>
      }
      ListEmptyComponent={
        query.data.hasData ? (
          <EmptyState title="No assigned sites" message="Your supervisor has not assigned any sites to you yet." />
        ) : (
          <EmptyState title="Not downloaded yet" message="Connect to the Internet and pull down to download your sites." />
        )
      }
      renderItem={({ item }) => <SiteCard site={item} />}
    />
  );
}

function SiteCard({ site }: { site: Site }) {
  const power = [
    site.generator_available && 'Generator',
    site.battery_available && 'Battery',
    site.solar_available && 'Solar',
    site.grid_available && 'Grid',
  ].filter(Boolean);
  return (
    <Link href={{ pathname: '/site/[id]', params: { id: site.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open site ${site.site_code} ${site.site_name}`}
      >
        <Card>
          <View style={styles.row}>
            <Text style={styles.code}>{site.site_code}</Text>
            <View style={styles.pills}>
              {site.is_demo ? <StatusPill status="DEMO" tone="neutral" /> : null}
              {site.status ? <StatusPill status={site.status} tone={site.status === 'ACTIVE' ? 'success' : 'neutral'} /> : null}
            </View>
          </View>
          <Text style={styles.name}>{site.site_name}</Text>
          <Text style={styles.meta}>
            {[site.region_name, site.county_name].filter(Boolean).join(' · ') ||
              'Location not set'}
          </Text>
          <Text style={styles.meta}>Power: {power.length ? power.join(', ') : 'Not recorded'}</Text>
        </Card>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pills: { flexDirection: 'row', gap: spacing.xs },
  code: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  name: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: spacing.xs },
  meta: { fontSize: 15, color: colors.textMuted, marginTop: spacing.xs },
});

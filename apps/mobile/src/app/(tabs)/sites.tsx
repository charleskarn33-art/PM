import { Link } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, EmptyState, LoadingView, StatusPill } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useRemoteQuery } from '@/lib/use-remote-query';
import { colors, spacing } from '@/theme';

const SITE_COLUMNS =
  'id, site_code, site_name, status, is_demo, generator_available, solar_available, battery_available, grid_available, regions(name), counties(name)';

async function fetchSites() {
  if (!supabase) throw new Error('Not configured.');
  const { data, error } = await supabase.from('sites').select(SITE_COLUMNS).order('site_name');
  if (error) throw new Error(error.message);
  return data;
}

type SiteRow = Awaited<ReturnType<typeof fetchSites>>[number];

export default function SitesScreen() {
  const query = useRemoteQuery(fetchSites, 'sites');
  if (query.loading) return <LoadingView label="Loading sites…" />;

  return (
    <FlatList
      data={query.data ?? []}
      keyExtractor={(s) => s.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={query.refreshing} onRefresh={query.refresh} />}
      ListHeaderComponent={query.error ? <Banner tone="danger" message={query.error} /> : null}
      ListEmptyComponent={
        query.error ? null : (
          <EmptyState
            title="No assigned sites"
            message="Your supervisor has not assigned any sites to you yet."
          />
        )
      }
      renderItem={({ item }) => <SiteCard site={item} />}
    />
  );
}

function SiteCard({ site }: { site: SiteRow }) {
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
              <StatusPill
                status={site.status}
                tone={site.status === 'ACTIVE' ? 'success' : 'neutral'}
              />
            </View>
          </View>
          <Text style={styles.name}>{site.site_name}</Text>
          <Text style={styles.meta}>
            {[site.regions?.name, site.counties?.name].filter(Boolean).join(' · ') ||
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

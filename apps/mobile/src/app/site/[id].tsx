import { humanizeStatus, PM_STATUS_TONE, toIsoDate } from '@ipt/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Card, EmptyState, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import { mapsUrl, webMapsUrl } from '@/lib/maps';
import { supabase } from '@/lib/supabase';
import { useRemoteQuery } from '@/lib/use-remote-query';
import { colors, spacing } from '@/theme';

export default function SiteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useRemoteQuery(async () => {
    if (!supabase) throw new Error('Not configured.');
    const { data, error } = await supabase.from('site_overview').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }, `site:${id}`);

  if (query.loading) return <LoadingView label="Loading site…" />;
  const site = query.data;
  if (!site) {
    return (
      <>
        <Stack.Screen options={{ title: 'Site' }} />
        {query.error ? <Banner tone="danger" message={query.error} /> : null}
        <EmptyState title="Site not available" message="This site is not assigned to you or no longer exists." />
      </>
    );
  }

  const today = toIsoDate(new Date());
  const overdue = site.next_pm_due != null && (site.next_pm_status === 'OVERDUE' || site.next_pm_due < today);
  const power = [
    site.generator_available && 'Generator',
    site.battery_available && 'Battery',
    site.solar_available && 'Solar',
    site.grid_available && 'Grid',
  ].filter(Boolean);
  const hasCoords = site.latitude != null && site.longitude != null;

  async function openMaps() {
    if (!hasCoords || !site) return;
    const url = mapsUrl(Platform.OS, site.latitude!, site.longitude!, `${site.site_code} ${site.site_name}`);
    const fallback = webMapsUrl(site.latitude!, site.longitude!);
    try {
      await Linking.openURL((await Linking.canOpenURL(url)) ? url : fallback);
    } catch {
      await Linking.openURL(fallback);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: site.site_code ?? 'Site' }} />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={query.refreshing} onRefresh={query.refresh} />}
      >
        {query.error ? <Banner tone="danger" message={query.error} /> : null}
        <View>
          <Text style={styles.name}>{site.site_name}</Text>
          <View style={styles.pills}>
            <StatusPill status={site.status ?? 'ACTIVE'} tone={site.status === 'ACTIVE' ? 'success' : 'neutral'} />
            {site.is_demo ? <StatusPill status="DEMO" tone="neutral" /> : null}
          </View>
        </View>

        <Card>
          <Row label="Region" value={site.region_name} />
          <Row label="Cluster" value={site.cluster_name} />
          <Row label="County" value={site.county_name} />
          <Row label="Supervisor" value={site.supervisor_name} />
          <Row label="Power" value={power.length ? power.join(', ') : 'Not recorded'} />
          {site.power_configuration ? <Row label="Configuration" value={site.power_configuration} /> : null}
        </Card>

        <Card>
          <Row
            label="Next PM"
            value={site.next_pm_due ?? 'Not scheduled'}
            right={
              site.next_pm_status ? (
                <StatusPill
                  status={overdue ? 'OVERDUE' : site.next_pm_status}
                  tone={overdue ? 'danger' : PM_STATUS_TONE[site.next_pm_status]}
                />
              ) : null
            }
          />
          <Row label="Last PM" value={site.last_pm_at ? new Date(site.last_pm_at).toLocaleDateString('en-GB') : '—'} />
          <Row label="Open failures" value={String(site.open_failures ?? 0)} />
          <Row label="Open corrective actions" value={String(site.open_corrective_actions ?? 0)} />
        </Card>

        <Card>
          <Row
            label="Coordinates"
            value={hasCoords ? `${site.latitude}, ${site.longitude}` : 'Not recorded'}
          />
          {site.address ? <Row label="Directions" value={site.address} /> : null}
          {hasCoords ? (
            <View style={{ marginTop: spacing.md }}>
              <PrimaryButton title="Open in Maps" variant="outline" onPress={() => void openMaps()} />
            </View>
          ) : (
            <Text style={styles.warn}>
              No site coordinates: GPS check-in cannot confirm you are on site. Tell your supervisor.
            </Text>
          )}
        </Card>
        <Text style={styles.note}>Site status: {humanizeStatus(site.status ?? '')}</Text>
      </ScrollView>
    </>
  );
}

function Row({ label, value, right }: { label: string; value: string | null; right?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value ?? '—'}</Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  name: { fontSize: 24, fontWeight: '800', color: colors.text },
  pills: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  label: { fontSize: 13, color: colors.textMuted, textTransform: 'uppercase', fontWeight: '600' },
  value: { fontSize: 17, color: colors.text, marginTop: 2 },
  warn: { marginTop: spacing.md, fontSize: 15, color: '#b45309' },
  note: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
});

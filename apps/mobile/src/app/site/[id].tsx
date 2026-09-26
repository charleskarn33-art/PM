import { PM_STATUS_TONE } from '@ipt/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SavedCopyNote } from '@/components/sync-bar';
import { Banner, Card, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import type { Schedule, Site, VisitSummary } from '@/lib/api/types';
import { useApi } from '@/lib/api/use-api';
import { mapsUrl, webMapsUrl } from '@/lib/maps';
import { useOffline } from '@/offline/offline-provider';
import { colors, spacing } from '@/theme';

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

/** Site details, its open PMs and recent visits; start an unscheduled PM. */
export default function SiteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const site = useApi<Site>(`/sites/${id}`);
  const schedules = useApi<Schedule[]>(`/pm-schedules?siteId=${id}&mine=true&pageSize=20`);
  const visits = useApi<VisitSummary[]>(`/visits?siteId=${id}&pageSize=10`);
  const { pack } = useOffline();
  // Offline without a saved copy: the site and its open PMs from the field pack.
  const packSite = site.error ? pack?.sites.find((x) => x.id === id) : undefined;
  const siteSchedules = schedules.data ?? (schedules.error ? pack?.schedules.filter((x) => x.siteId === id) : undefined);

  if (site.loading) return <LoadingView />;
  const s = site.data ?? packSite;
  if (!s) return <Banner tone="danger" message={site.error ?? 'Site not found.'} />;
  const lat = s.latitude == null ? null : Number(s.latitude);
  const lng = s.longitude == null ? null : Number(s.longitude);
  const label = `${s.siteCode} ${s.siteName}`;

  async function openMaps() {
    if (lat == null || lng == null) return;
    const url = mapsUrl(Platform.OS, lat, lng, label);
    if (await Linking.canOpenURL(url).catch(() => false)) await Linking.openURL(url);
    else await Linking.openURL(webMapsUrl(lat, lng));
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={site.refreshing} onRefresh={() => void Promise.all([site.reload(), schedules.reload(), visits.reload()])} />}
    >
      <Stack.Screen options={{ title: s.siteCode }} />
      <SavedCopyNote savedAt={site.savedAt} />
      {packSite ? <Text style={styles.meta}>Offline: showing the site as saved on this phone.</Text> : null}
      <Card style={{ gap: spacing.xs }}>
        <Text style={styles.name}>{s.siteName}</Text>
        <Text style={styles.meta}>{[s.region?.name, s.cluster?.name, s.county?.name].filter(Boolean).join(' · ')}</Text>
        {s.address ? <Text style={styles.meta}>{s.address}</Text> : null}
        <Text style={styles.meta}>{lat != null && lng != null ? `GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'No GPS coordinates recorded'}</Text>
        {lat != null ? <PrimaryButton title="Open in maps" variant="outline" onPress={() => void openMaps()} /> : null}
      </Card>
      <Card>
        <Row label="Generator" value={yesNo(s.generatorAvailable)} />
        <Row label="Solar" value={yesNo(s.solarAvailable)} />
        <Row label="Grid" value={yesNo(s.gridAvailable)} />
        <Row label="Batteries" value={s.batteryUnitCount ? `${s.batteryUnitCount} (each recorded)` : (s.batteryConfiguration ?? '—')} />
        {s.powerConfiguration ? <Row label="Power" value={s.powerConfiguration} /> : null}
      </Card>

      <Text style={styles.heading}>My PMs at this site</Text>
      {(siteSchedules ?? []).filter((x) => x.status !== 'CANCELLED').slice(0, 5).map((x) => (
        <Card key={x.id} style={styles.line}>
          <Text style={styles.meta}>Due {x.dueDate}</Text>
          <StatusPill status={x.status} tone={PM_STATUS_TONE[x.status]} />
        </Card>
      ))}
      <PrimaryButton title="Start unscheduled PM" onPress={() => router.push({ pathname: '/pm/start', params: { siteId: s.id, siteName: `${s.siteCode} · ${s.siteName}` } })} />

      <Text style={styles.heading}>Recent visits</Text>
      {visits.data?.length ? null : <Text style={styles.meta}>{visits.error ? visits.error : 'No visits yet.'}</Text>}
      {(visits.data ?? []).map((v) => (
        <Card key={v.id} style={styles.line}>
          <Text style={styles.meta}>
            {v.startedAt.slice(0, 10)} · {Math.floor(v.completionPct)}% · {v.failureCount} failure{v.failureCount === 1 ? '' : 's'}
          </Text>
          <StatusPill status={v.status} tone={PM_STATUS_TONE[v.status]} />
        </Card>
      ))}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  name: { fontSize: 22, fontWeight: '800', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  value: { fontSize: 16, fontWeight: '600', color: colors.text, flexShrink: 1, textAlign: 'right' },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

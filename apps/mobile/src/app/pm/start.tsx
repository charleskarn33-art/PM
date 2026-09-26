import { evaluateGeofence } from '@ipt/shared';
import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { Banner, Card, LoadingView, PrimaryButton } from '@/components/ui';
import { sessionClient } from '@/lib/api/session';
import { ApiError } from '@/lib/api/session-client';
import type { Settings, Site, VisitDetail } from '@/lib/api/types';
import { errorMessage, useApi } from '@/lib/api/use-api';
import { capturePosition, type CapturedPosition } from '@/lib/location';
import { useOffline } from '@/offline/offline-provider';
import { isEditable, startVisitLocally, type StartPayload } from '@/offline/visit-ops';
import { formatDistance } from '@/pm/model';
import { useAuth } from '@/providers/auth-provider';
import { colors, radius, spacing, touchTarget } from '@/theme';

/**
 * Start (or continue) a PM: takes a GPS fix, shows where the technician is
 * against the site's geofence as configured (WARN, REQUIRE_REASON, BLOCK),
 * asks for a reason when required, then starts the visit. The server applies
 * the same rules to the position sent. Without a connection the visit is
 * started on the phone from the saved field pack and sent later.
 */
export default function StartPmScreen() {
  const { scheduleId, siteId, siteName, resume } = useLocalSearchParams<{ scheduleId?: string; siteId: string; siteName?: string; resume?: string }>();
  const router = useRouter();
  const { userId } = useAuth();
  const { store, pack, requestSync } = useOffline();
  const settingsQuery = useApi<Settings>('/settings');
  const siteQuery = useApi<Site>(`/sites/${siteId}`);
  // Without a connection, the copies in the field pack.
  const settings = settingsQuery.data ?? pack?.settings ?? null;
  const site = siteQuery.data ?? pack?.sites.find((s) => s.id === siteId) ?? null;
  const [fix, setFix] = useState<CapturedPosition | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per start attempt: a retry after a lost connection returns the same visit.
  const visitId = useRef(randomUUID());

  async function start(withGps: boolean) {
    if (!sessionClient || !store || !userId) return;
    setBusy(true);
    setError(null);
    const body: StartPayload = {
      id: visitId.current,
      ...(scheduleId ? { scheduleId } : { siteId }),
      clientCreatedAt: new Date().toISOString(),
      ...(withGps && fix?.position
        ? { gps: { latitude: fix.position.latitude, longitude: fix.position.longitude, capturedAt: fix.position.capturedAt, ...(fix.position.accuracyM != null ? { accuracyM: fix.position.accuracyM } : {}) } }
        : {}),
      ...(reason.trim() ? { outsideRadiusReason: reason.trim() } : {}),
    };
    try {
      const { data } = await sessionClient.request<VisitDetail>('/visits', { method: 'POST', body });
      await store.saveBase(data, true);
      router.replace(`/pm/${data.id}`);
    } catch (e) {
      if (!(e instanceof ApiError && e.offline)) {
        setError(errorMessage(e, 'start the PM'));
        setBusy(false);
        return;
      }
      // No connection: start on the phone; the start is sent (and checked again) later.
      const local = pack ? startVisitLocally(pack, { ...body, technicianId: userId }) : { ok: false as const, message: 'No connection, and the PM data is not saved on this phone yet. Connect once to download it.' };
      if (!local.ok) {
        setError(local.message);
        setBusy(false);
        return;
      }
      await store.saveBase(local.visit, false);
      await store.enqueue(local.visit.id, { kind: 'start', payload: body });
      requestSync();
      router.replace(`/pm/${local.visit.id}`);
    }
  }

  /** Continuing an open PM: the copy on the phone, else the server's. */
  async function resumeVisit() {
    const saved = store ? (await store.visits()).find((v) => v.visit.scheduleId === scheduleId && isEditable(v.visit)) : undefined;
    if (saved) return router.replace(`/pm/${saved.visit.id}`);
    try {
      const { data } = await sessionClient!.request<VisitDetail>('/visits', { method: 'POST', body: scheduleId ? { scheduleId } : { siteId } });
      await store?.saveBase(data, true);
      router.replace(`/pm/${data.id}`);
    } catch (e) {
      setError(errorMessage(e, 'open the PM'));
    }
  }

  // Continuing an open PM needs no new position.
  const resumed = useRef(false);
  useEffect(() => {
    if (resume && store && !resumed.current) {
      resumed.current = true;
      void resumeVisit();
    } else if (!resume) {
      void capturePosition().then(setFix);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, store]);

  if (resume) return error ? <Banner tone="danger" message={error} /> : <LoadingView label="Opening PM…" />;
  if ((!settings && settingsQuery.loading) || (!site && siteQuery.loading) || !fix) return <LoadingView label="Getting your location…" />;
  if (!settings || !site) return <Banner tone="danger" message={settingsQuery.error ?? siteQuery.error ?? 'Unable to load.'} />;

  const geo = evaluateGeofence({
    site: {
      latitude: site.latitude == null ? null : Number(site.latitude),
      longitude: site.longitude == null ? null : Number(site.longitude),
      geofenceRadiusM: site.geofenceRadiusM,
    },
    defaultRadiusM: settings.geofence.radiusM,
    mode: settings.geofence.mode,
    position: fix.position,
  });
  const where =
    geo.status === 'WITHIN_RADIUS'
      ? { tone: 'success' as const, text: `You are at the site (${formatDistance(geo.distanceM)} away, allowed ${geo.radiusM} m).` }
      : geo.status === 'OUTSIDE_RADIUS'
        ? { tone: geo.blocked ? ('danger' as const) : ('warning' as const), text: `You are ${formatDistance(geo.distanceM)} from the site (allowed ${geo.radiusM} m).` }
        : geo.status === 'UNAVAILABLE'
          ? { tone: geo.blocked ? ('danger' as const) : ('warning' as const), text: fix.problem ?? 'Your location is unavailable.' }
          : { tone: 'info' as const, text: 'This site has no GPS coordinates recorded, so your location cannot be checked.' };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Start PM' }} />
      <Text style={styles.site}>{siteName ?? `${site.siteCode} · ${site.siteName}`}</Text>
      <Banner tone={where.tone} message={where.text} />
      {fix.position?.accuracyM != null ? <Text style={styles.meta}>GPS accuracy ±{Math.round(fix.position.accuracyM)} m</Text> : null}
      {geo.blocked ? <Banner tone="danger" message="PM can only be started at the site. Move closer and check your location again." /> : null}
      {geo.reasonRequired ? (
        <Card style={{ gap: spacing.sm }}>
          <Text style={styles.label}>Reason for starting PM here</Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={500}
            placeholder="e.g. access road flooded; inspected from the gate"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Reason for starting PM outside the site radius"
          />
        </Card>
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
      <PrimaryButton title="Check my location again" variant="outline" onPress={() => void capturePosition().then(setFix)} disabled={busy} />
      <PrimaryButton title="Start PM" loading={busy} disabled={geo.blocked || (geo.reasonRequired && !reason.trim())} onPress={() => void start(true)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  site: { fontSize: 20, fontWeight: '800', color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  input: {
    minHeight: touchTarget * 2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 17,
    color: colors.text,
    textAlignVertical: 'top',
    backgroundColor: colors.white,
  },
});

import { evaluateGeofence, formatDistance, humanizeStatus, isPmOverdue, PM_STATUS_TONE, toIsoDate, type GeofenceResult } from '@ipt/shared';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Banner, Card, EmptyState, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import { SyncBar } from '@/components/sync-bar';
import { capturePosition, type CapturedPosition } from '@/lib/location';
import { buildPmRows, type PmRow } from '@/pm/list';
import { useAuth } from '@/providers/auth-provider';
import { useLocalQuery, useOffline } from '@/providers/offline-provider';
import { colors, radius, spacing } from '@/theme';

interface ReasonPrompt {
  row: PmRow;
  gps: CapturedPosition;
  result: GeofenceResult;
}

export default function PmScreen() {
  const { profile } = useAuth();
  const { store, changed, syncNow, status } = useOffline();
  const router = useRouter();
  const { submitted } = useLocalSearchParams<{ submitted?: string }>();
  const userId = profile?.id;
  const isTechnician = profile?.role === 'technician';
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<ReasonPrompt | null>(null);
  const [reason, setReason] = useState('');

  const query = useLocalQuery(async (s) => {
    if (!userId) return { rows: [] as PmRow[], hasData: false };
    const [schedules, visits, sites, ops, hasData] = await Promise.all([s.schedules(), s.visits(), s.sites(), s.ops(), s.hasData()]);
    return { rows: buildPmRows(schedules, visits, sites, userId, new Set(ops.map((o) => o.visit_id))), hasData };
  }, `pm:${userId}`);

  async function createVisit(row: PmRow, gps: CapturedPosition, result: GeofenceResult, outsideReason: string | null) {
    if (!store || !userId) return;
    const id = randomUUID(); // generated on the phone, so a re-sent request cannot create a duplicate visit
    const now = new Date().toISOString();
    await store.createVisit(
      {
        id,
        site_id: row.siteId,
        template_id: row.templateId,
        technician_id: userId,
        schedule_id: row.scheduleId,
        started_at: now,
        gps_latitude: gps.position?.latitude ?? null,
        gps_longitude: gps.position?.longitude ?? null,
        gps_accuracy_m: gps.position?.accuracyM ?? null,
        gps_captured_at: gps.position?.capturedAt ?? null,
        outside_radius_reason: outsideReason,
        device_id: null,
        client_created_at: now,
      },
      { gps_distance_m: result.distanceM, gps_radius_m: result.radiusM, gps_status: result.status, geofence_mode: result.mode },
    );
    changed();
    router.push({ pathname: '/pm/[visitId]', params: { visitId: id } });
  }

  async function start(row: PmRow) {
    if (row.visitId) {
      router.push({ pathname: '/pm/[visitId]', params: { visitId: row.visitId } });
      return;
    }
    if (!store) return;
    setStarting(row.key);
    setStartError(null);
    setGpsNotice(null);
    try {
      const [site, settings, template] = await Promise.all([store.site(row.siteId), store.settings(), store.template(row.templateId)]);
      if (!template) {
        setStartError('The checklist for this PM has not been downloaded yet. Connect to the Internet and pull down to sync.');
        return;
      }
      const gps = await capturePosition();
      const result = evaluateGeofence({
        site: { latitude: site?.latitude ?? null, longitude: site?.longitude ?? null, geofenceRadiusM: site?.geofence_radius_m },
        defaultRadiusM: settings.geofence?.radius_m ?? 100,
        mode: settings.geofence?.mode ?? 'WARN',
        position: gps.position,
      });
      const detail = [result.message, gps.problem].filter(Boolean).join(' ');
      if (result.blocked) {
        setStartError(detail || 'PM cannot be started here.');
        return;
      }
      if (result.reasonRequired) {
        setReason('');
        setPrompt({ row, gps, result });
        return;
      }
      if (result.status !== 'WITHIN_RADIUS' && detail) setGpsNotice(detail);
      await createVisit(row, gps, result, null);
    } catch (e) {
      setStartError(`Unable to start PM: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStarting(null);
    }
  }

  async function startWithReason() {
    if (!prompt || !reason.trim()) return;
    const p = prompt;
    setPrompt(null);
    setStarting(p.row.key);
    try {
      await createVisit(p.row, p.gps, p.result, reason.trim());
    } catch (e) {
      setStartError(`Unable to start PM: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStarting(null);
    }
  }

  if (!isTechnician) {
    return <EmptyState title="PM is for technicians" message="Preventive maintenance is performed by Technicians." />;
  }
  if (query.loading || !query.data) return <LoadingView label="Loading PM…" />;
  const today = toIsoDate(new Date());

  return (
    <FlatList
      data={query.data.rows}
      keyExtractor={(r) => r.key}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={status.syncing} onRefresh={() => void syncNow()} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          <SyncBar />
          {submitted ? <Banner tone="success" message="PM submitted. It is sent automatically; your supervisor will review it." /> : null}
          {query.error ? <Banner tone="danger" message={query.error} /> : null}
          {startError ? <Banner tone="danger" message={startError} /> : null}
          {gpsNotice ? <Banner tone="warning" message={`Started outside the site area: ${gpsNotice}`} /> : null}
          {prompt ? (
            <Card style={{ gap: spacing.sm }}>
              <Text style={styles.promptTitle}>Reason required</Text>
              <Text style={styles.meta}>
                {prompt.result.message}
                {prompt.result.distanceM != null ? ` You are ${formatDistance(prompt.result.distanceM)} from the site (allowed ${prompt.result.radiusM} m).` : ''}
                {prompt.gps.problem ? ` ${prompt.gps.problem}` : ''}
              </Text>
              <TextInput
                accessibilityLabel="Reason for starting PM outside the site area"
                style={styles.input}
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Access road flooded; working from the gate"
                multiline
              />
              <PrimaryButton title="Start PM with this reason" disabled={!reason.trim()} onPress={() => void startWithReason()} />
              <PrimaryButton title="Cancel" variant="outline" onPress={() => setPrompt(null)} />
            </Card>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        query.data.hasData ? (
          <EmptyState title="No PM to do" message="You have no open PM assignments." />
        ) : (
          <EmptyState title="Not downloaded yet" message="Connect to the Internet and pull down to download your PM work." />
        )
      }
      renderItem={({ item: r }) => {
        const overdue = r.due != null && isPmOverdue(r.status, r.due, today);
        return (
          <Card style={{ gap: spacing.sm }}>
            <View style={styles.row}>
              <Text style={styles.code}>{r.siteCode}</Text>
              <View style={styles.pills}>
                {r.waitingToSend ? <StatusPill status="Waiting to send" tone="info" /> : null}
                <StatusPill status={overdue ? 'OVERDUE' : r.status} tone={overdue ? 'danger' : PM_STATUS_TONE[r.status]} />
              </View>
            </View>
            <Text style={styles.name}>{r.siteName}</Text>
            <Text style={styles.meta}>
              {r.due ? `Due ${r.due}` : 'Unscheduled PM'}
              {r.frequency ? ` · ${humanizeStatus(r.frequency).toLowerCase()}` : ''}
              {r.completion != null && r.visitId ? ` · ${Math.round(r.completion)}% complete (last sync)` : ''}
            </Text>
            {r.status === 'REJECTED' && r.review ? <Banner tone="danger" message={`Returned: ${r.review}`} /> : null}
            <PrimaryButton
              title={
                r.status === 'SUBMITTED'
                  ? 'View submitted PM'
                  : r.visitId
                    ? r.status === 'REJECTED'
                      ? 'Fix & resubmit'
                      : 'Continue PM'
                    : 'Start PM'
              }
              variant={r.status === 'SUBMITTED' ? 'outline' : 'primary'}
              loading={starting === r.key}
              disabled={starting != null && starting !== r.key}
              onPress={() => void start(r)}
            />
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pills: { flexDirection: 'row', gap: spacing.xs, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  code: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  name: { fontSize: 20, fontWeight: '800', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  promptTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    textAlignVertical: 'top',
  },
});

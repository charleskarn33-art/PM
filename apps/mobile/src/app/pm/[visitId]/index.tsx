import { PM_STATUS_TONE } from '@ipt/shared';
import { Stack, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Banner, Card, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import { ProgressBar, TextField } from '@/components/answer-controls';
import { VisitSync } from '@/components/visit-sync';
import { useVisit } from '@/pm/visit-context';
import { colors, spacing, toneColors } from '@/theme';

/** Visit overview: progress, sections (with N/A switches), comments, then review & complete. */
export default function VisitScreen() {
  const pm = useVisit();
  const router = useRouter();
  if (pm.loading) return <LoadingView />;
  if (!pm.visit) return <Banner tone="danger" message={pm.error ?? 'PM not found.'} />;
  const v = pm.visit;
  const na = new Set(v.notApplicableSections);
  const sectionIssues = (code: string) => v.issues.filter((i) => i.sectionCode === code).length;

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void pm.reload()} />}>
      <Stack.Screen options={{ title: v.site.siteCode }} />
      <Card style={{ gap: spacing.sm }}>
        <View style={styles.line}>
          <Text style={styles.site}>{v.site.siteName}</Text>
          <StatusPill status={v.status} tone={PM_STATUS_TONE[v.status]} />
        </View>
        <Text style={styles.meta}>
          {v.template.name} (v{v.template.version}) · started {v.startedAt.slice(0, 16).replace('T', ' ')}
        </Text>
        <ProgressBar pct={v.progress.completionPct} />
        <Text style={[styles.meta, v.progress.failureCount > 0 && { color: toneColors.danger.fg, fontWeight: '700' }]}>Failures recorded: {v.progress.failureCount}</Text>
        {v.gpsStatus === 'OUTSIDE_RADIUS' ? <Text style={styles.meta}>Started {Math.round(v.gpsDistanceM ?? 0)} m from the site.</Text> : null}
      </Card>
      <VisitSync />
      {v.status === 'REJECTED' && v.reviewComments ? <Banner tone="danger" message={`Returned by your supervisor: ${v.reviewComments}`} /> : null}
      {pm.saveError ? <Banner tone="danger" message={pm.saveError} /> : null}
      {!pm.editable ? <Banner tone="info" message={v.status === 'COMPLETED' && pm.syncStatus !== 'SYNCED' ? 'Completed on this phone; it is sent to the server when there is a connection.' : 'This PM is completed and can no longer be changed.'} /> : null}

      {v.sections.map((s) => {
        const p = v.progress.sections.find((x) => x.code === s.code);
        const isNa = na.has(s.code);
        const issues = sectionIssues(s.code);
        return (
          <Card key={s.id} style={{ gap: spacing.sm }}>
            <Pressable accessibilityRole="button" disabled={isNa} onPress={() => router.push(`/pm/${v.id}/section/${s.id}`)} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.section, isNa && { color: colors.textMuted }]}>{s.name}</Text>
                <Text style={styles.meta}>
                  {isNa ? 'Not applicable' : `${p?.done ?? 0} of ${p?.required ?? 0} required done${p?.failures ? ` · ${p.failures} failure${p.failures === 1 ? '' : 's'}` : ''}`}
                </Text>
              </View>
              {!isNa && issues === 0 && (p?.required ?? 0) > 0 ? <Text style={[styles.badge, { color: toneColors.success.fg }]}>✓</Text> : null}
              {!isNa && issues > 0 ? <Text style={[styles.badge, { color: toneColors.warning.fg }]}>{issues}</Text> : null}
            </Pressable>
            {s.allowNotApplicable ? (
              <View style={styles.line}>
                <Text style={styles.meta}>Not applicable at this site</Text>
                <Switch value={isNa} disabled={!pm.editable} onValueChange={(on) => void pm.setNotApplicable(s.code, on)} accessibilityLabel={`${s.name} not applicable`} />
              </View>
            ) : null}
          </Card>
        );
      })}

      {v.engine.batteryUnits && !na.has(v.engine.batteryUnits.sectionCode) ? (
        <PrimaryButton title="Battery voltages" variant="outline" onPress={() => router.push(`/pm/${v.id}/battery`)} />
      ) : null}

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.section}>Overall comments</Text>
        <TextField label="Overall comments" value={v.overallComments} multiline disabled={!pm.editable} onCommit={(t) => void pm.saveOverallComments(t ?? '')} placeholder="Anything the supervisor should know" />
      </Card>
      {pm.editable ? <PrimaryButton title="Review & complete" onPress={() => router.push(`/pm/${v.id}/review`)} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  site: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text },
  section: { fontSize: 18, fontWeight: '700', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  badge: { fontSize: 20, fontWeight: '800', minWidth: 28, textAlign: 'center' },
});

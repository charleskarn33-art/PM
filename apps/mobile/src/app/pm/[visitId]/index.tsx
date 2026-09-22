import { humanizeStatus, PM_STATUS_TONE } from '@ipt/shared';
import { Link, Stack } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Banner, Card, LoadingView, PrimaryButton, StatusPill } from '@/components/ui';
import { usePmVisitContext } from '@/pm/context';
import { ProgressBar } from '@/pm/controls';
import { colors, spacing, toneColors } from '@/theme';

export default function PmVisitScreen() {
  const pm = usePmVisitContext();
  if (pm.loading) return <LoadingView label="Loading PM checklist…" />;
  if (!pm.visit) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Banner tone="danger" message={pm.error ?? 'PM visit not found.'} />
      </View>
    );
  }
  const { visit } = pm;
  const na = new Set(visit.not_applicable_sections);

  return (
    <>
      <Stack.Screen options={{ title: pm.site ? `${pm.site.site_code} PM` : 'PM' }} />
      <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={false} onRefresh={pm.reload} />}>
        <View>
          <Text style={styles.site}>{pm.site?.site_name}</Text>
          <View style={styles.row}>
            <StatusPill status={visit.status} tone={PM_STATUS_TONE[visit.status]} />
            {pm.progress.failureCount > 0 ? <StatusPill status={`${pm.progress.failureCount} failure(s)`} tone="danger" /> : null}
          </View>
        </View>
        {visit.status === 'REJECTED' && visit.review_comments ? (
          <Banner tone="danger" message={`Returned by supervisor: ${visit.review_comments}`} />
        ) : null}
        {pm.saveError ? (
          <View style={{ gap: spacing.sm }}>
            <Banner tone="danger" message={pm.saveError} />
            <PrimaryButton title="Retry" variant="outline" onPress={pm.retryFailed} />
          </View>
        ) : null}
        <Card>
          <ProgressBar pct={pm.progress.completionPct} />
          <Text style={styles.meta}>
            {pm.issues.length === 0 ? 'Everything required is complete.' : `${pm.issues.length} item(s) still need attention.`}
          </Text>
        </Card>

        {pm.sections.map((section) => {
          const p = pm.progress.sections.find((s) => s.code === section.code);
          const isNa = na.has(section.code);
          return (
            <Card key={section.id} style={isNa ? { opacity: 0.7 } : undefined}>
              <Link href={{ pathname: '/pm/[visitId]/section/[sectionId]', params: { visitId: visit.id, sectionId: section.id } }} asChild disabled={isNa}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Open ${section.name}`} style={styles.sectionHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionName}>{section.name}</Text>
                    <Text style={styles.meta}>
                      {isNa ? 'Not applicable' : `${p?.done ?? 0} of ${p?.required ?? 0} required done`}
                      {!isNa && p?.failures ? ` · ${p.failures} failure(s)` : ''}
                    </Text>
                  </View>
                  {!isNa ? (
                    <Text style={[styles.count, { color: p && p.done === p.required ? toneColors.success.fg : colors.textMuted }]}>
                      {p && p.required > 0 ? `${Math.round((100 * p.done) / p.required)}%` : '—'}
                    </Text>
                  ) : null}
                </Pressable>
              </Link>
              {section.allow_not_applicable && pm.editable ? (
                <View style={styles.naRow}>
                  <Text style={styles.meta}>Section not applicable on this site</Text>
                  <Switch
                    value={isNa}
                    onValueChange={(v) => void pm.setSectionNotApplicable(section.code, v)}
                    accessibilityLabel={`Mark ${section.name} not applicable`}
                  />
                </View>
              ) : null}
            </Card>
          );
        })}

        {pm.editable ? (
          <Link href={{ pathname: '/pm/[visitId]/submit', params: { visitId: visit.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.submit}>
              <Text style={styles.submitText}>Review & submit PM</Text>
            </Pressable>
          </Link>
        ) : (
          <Banner tone="info" message={`This PM is ${humanizeStatus(visit.status).toLowerCase()} and can no longer be edited.`} />
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  site: { fontSize: 22, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  sectionName: { fontSize: 18, fontWeight: '700', color: colors.text },
  count: { fontSize: 18, fontWeight: '800' },
  naRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  submit: { backgroundColor: colors.red, minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: colors.white, fontSize: 18, fontWeight: '700' },
});

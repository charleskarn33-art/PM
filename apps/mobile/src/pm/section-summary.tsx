import { dcPowerKw, totalPhaseCurrentA, type Enums } from '@ipt/shared';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { keyedValue, phaseCurrents } from './model';
import type { PmVisitModel } from './use-pm-visit';

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, warn && { color: '#b45309' }]}>{value}</Text>
    </View>
  );
}

const fmt = (v: number | null, unit: string, digits = 2) => (v == null ? '—' : `${Number(v.toFixed(digits))} ${unit}`);

/** Live, section-specific figures while the technician fills the form. */
export function SectionLiveSummary({ category, pm }: { category: Enums<'pm_category'>; pm: PmVisitModel }) {
  const key = (k: string) => keyedValue(k, pm.fields, pm.items, pm.readings, pm.responses);
  if (category === 'DC_SYSTEM') {
    const kw = dcPowerKw(key('dc.rectifier_voltage_v'), key('dc.load_current_a'));
    const phases = phaseCurrents(pm.items, pm.responses);
    return (
      <Card style={styles.card}>
        <Stat label="DC power (V × A ÷ 1000)" value={fmt(kw, 'kW', 3)} />
        <Stat label={`Phase total (${phases.length} phase${phases.length === 1 ? '' : 's'})`} value={fmt(totalPhaseCurrentA(phases.map((p) => p.amps)), 'A')} />
      </Card>
    );
  }
  if (category === 'SOLAR') {
    const installed = key('solar.panels_installed');
    const operational = key('solar.panels_operational');
    return (
      <Card style={styles.card}>
        <Stat
          label="Panels operational / installed"
          value={installed == null ? '—' : `${operational ?? '—'} / ${installed}`}
          warn={installed != null && operational != null && operational < installed}
        />
      </Card>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: spacing.lg, backgroundColor: '#eef1f6' },
  stat: { flex: 1 },
  label: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  value: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 2 },
});

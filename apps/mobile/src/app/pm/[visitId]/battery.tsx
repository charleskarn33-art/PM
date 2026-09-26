import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { NumberField } from '@/components/answer-controls';
import { Banner, Card, LoadingView } from '@/components/ui';
import { useVisit } from '@/pm/visit-context';
import { colors, spacing } from '@/theme';

/** Each battery's voltage (sites with a configured battery count). */
export default function BatteryUnitsScreen() {
  const pm = useVisit();
  const [error, setError] = useState<string | null>(null);
  if (pm.loading || !pm.visit) return <LoadingView />;
  const units = pm.visit.modules.battery?.units ?? [];
  const required = pm.visit.issues.filter((i) => i.refType === 'battery_unit').map((i) => Number(i.refId));
  const count = Math.max(units.length + required.length, ...units.map((u) => u.unitNumber), ...required);
  if (!count) return <Banner tone="info" message="This site has no battery count configured." />;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Battery voltages' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
        const u = units.find((x) => x.unitNumber === n);
        return (
          <Card key={n} style={{ gap: spacing.sm }}>
            <View style={styles.row}>
              <Text style={styles.label}>Battery {n} *</Text>
            </View>
            <NumberField
              label={`Battery ${n} voltage`}
              value={u?.voltageV ?? null}
              unit="V"
              minValue={null}
              maxValue={null}
              isInteger={false}
              disabled={!pm.editable}
              onCommit={(voltageV) => void pm.saveBatteryUnits([{ unitNumber: n, voltageV }]).then(setError)}
            />
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 80 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 17, fontWeight: '700', color: colors.text },
});

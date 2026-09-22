import { Stack, useLocalSearchParams } from 'expo-router';
import { PmVisitProvider } from '@/pm/context';
import { colors } from '@/theme';

export default function PmVisitLayout() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  return (
    <PmVisitProvider visitId={visitId}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.navy },
          headerTintColor: colors.white,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </PmVisitProvider>
  );
}

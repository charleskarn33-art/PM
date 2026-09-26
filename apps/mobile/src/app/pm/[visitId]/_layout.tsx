import { Stack, useLocalSearchParams } from 'expo-router';
import { VisitProvider } from '@/pm/visit-context';
import { colors } from '@/theme';

export default function VisitLayout() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  return (
    <VisitProvider visitId={visitId}>
      <Stack screenOptions={{ headerStyle: { backgroundColor: colors.navy }, headerTintColor: colors.white, headerTitleStyle: { fontWeight: '700' } }} />
    </VisitProvider>
  );
}

import { isMobileRole } from '@ipt/shared';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LoadingView } from '@/components/ui';
import { mobileEnv } from '@/lib/env';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

function RootNavigator() {
  const { status, profile } = useAuth();

  if (status === 'loading') return <LoadingView label="Starting…" />;

  const signedIn = status === 'signed-in';
  const fieldUser = signedIn && Boolean(profile?.is_active) && isMobileRole(profile?.role);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={fieldUser}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="pm/[visitId]" options={{ headerShown: false }} />
        <Stack.Screen
          name="site/[id]"
          options={{
            headerShown: true,
            title: 'Site',
            headerStyle: { backgroundColor: colors.navy },
            headerTintColor: colors.white,
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !fieldUser}>
        <Stack.Screen name="account-status" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  if (!mobileEnv.ok) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.config}>
          <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
            <Text style={styles.configTitle}>App not configured</Text>
            <Text style={styles.configText}>{mobileEnv.error}</Text>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  config: { flex: 1, backgroundColor: colors.background },
  configTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  configText: { fontSize: 16, color: colors.textMuted, marginTop: spacing.md },
});

import { isMobileRole } from '@ipt/shared';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PushHandler } from '@/components/push-handler';
import { LaunchScreen } from '@/components/launch-screen';
import { mobileEnv } from '@/lib/env';
import { onboarding } from '@/lib/onboarding-store';
import { OfflineProvider } from '@/offline/offline-provider';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

// Read once at start-up, while the launch screen shows.
void onboarding.load();

/** The launch screen until the session and the introduction state are known, then the app. */
function RootNavigator() {
  const { status } = useAuth();
  const intro = useSyncExternalStore(onboarding.subscribe, onboarding.get);
  const ready = status !== 'loading' && intro !== 'loading';
  const [launched, setLaunched] = useState(false);
  const onHidden = useCallback(() => setLaunched(true), []);
  // Already signed in (e.g. after an update that added the introduction): no need to show it later.
  useEffect(() => {
    if (status === 'signed-in' && intro === 'pending') void onboarding.complete();
  }, [status, intro]);
  return (
    <>
      <StatusBar style={launched ? 'dark' : 'light'} />
      {ready ? <Screens introDone={intro === 'done'} /> : null}
      {launched ? null : <LaunchScreen ready={ready} onHidden={onHidden} />}
    </>
  );
}

function Screens({ introDone }: { introDone: boolean }) {
  const { status, profile } = useAuth();
  const signedIn = status === 'signed-in';
  const mustChangePassword = signedIn && Boolean(profile?.must_change_password);
  const fieldUser = signedIn && !mustChangePassword && Boolean(profile?.is_active) && isMobileRole(profile?.role);

  return (
    <>
      {fieldUser ? <PushHandler pmWork={profile?.role !== 'maintenance'} /> : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={fieldUser}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="pm/[visitId]" options={{ headerShown: false }} />
        <Stack.Screen
          name="pm/start"
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: colors.navy },
            headerTintColor: colors.white,
            title: 'Start PM',
          }}
        />
        <Stack.Screen name="action/[id]" options={{ headerShown: false }} />
        <Stack.Screen
          name="failure/report"
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: colors.navy },
            headerTintColor: colors.white,
            title: 'Report a failure',
          }}
        />
        <Stack.Screen name="introduction" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="notifications"
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: colors.navy },
            headerTintColor: colors.white,
            title: 'Notifications',
          }}
        />
        <Stack.Screen
          name="site/[id]"
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: colors.navy },
            headerTintColor: colors.white,
            title: 'Site',
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={mustChangePassword}>
        <Stack.Screen name="change-password" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !mustChangePassword && !fieldUser}>
        <Stack.Screen name="account-status" />
      </Stack.Protected>
      {/* First start on this phone: the introduction comes before sign-in. */}
      <Stack.Protected guard={!signedIn && !introDone}>
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn && introDone}>
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
      </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  if (!mobileEnv.ok) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.config} onLayout={() => void SplashScreen.hideAsync().catch(() => undefined)}>
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
        <OfflineProvider>
          <RootNavigator />
        </OfflineProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  config: { flex: 1, backgroundColor: colors.background },
  configTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  configText: { fontSize: 16, color: colors.textMuted, marginTop: spacing.md },
});

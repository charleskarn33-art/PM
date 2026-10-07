import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/theme';

// Keep the phone's own launch image up until this screen has drawn (same image, same place),
// so the start looks like one screen rather than two.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const LOGO = 160; // as `imageWidth` of the expo-splash-screen plugin in app.json
const MIN_SHOWN_MS = 700; // long enough to read the name, short enough not to be in the way

/**
 * The launch screen: the logo where the phone's launch image left it, the
 * app's name, and what is happening (restoring the session, opening the
 * phone's offline data). Fades out once the app is ready.
 */
export function LaunchScreen({ ready, onHidden }: { ready: boolean; onHidden: () => void }) {
  // Created once (lazy state, not read from refs while rendering).
  const [shownAt] = useState(() => Date.now());
  const [opacity] = useState(() => new Animated.Value(1));
  const [text] = useState(() => new Animated.Value(0));
  const [rise] = useState(() => text.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }));
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    Animated.timing(text, { toValue: 1, duration: 400, delay: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    // Say why it is still starting when it takes a while (a large offline store on an old phone).
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, MIN_SHOWN_MS - (Date.now() - shownAt));
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 250, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(({ finished }) => finished && onHidden());
    }, wait);
    return () => clearTimeout(t);
  }, [ready, opacity, onHidden, shownAt]);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity }]}
      onLayout={() => void SplashScreen.hideAsync().catch(() => undefined)}
      accessible
      accessibilityLabel={ready ? 'IPT PowerTech PM is ready' : 'IPT PowerTech PM is starting'}
      accessibilityLiveRegion="polite"
      pointerEvents={ready ? 'none' : 'auto'}
    >
      <View style={styles.center}>
        <Image source={require('../../assets/splash-icon.png')} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
      </View>
      <Animated.View style={[styles.below, { opacity: text, transform: [{ translateY: rise }] }]}>
        <Text style={styles.name}>IPT PowerTech</Text>
        <Text style={styles.tagline}>Preventive Maintenance · Field App</Text>
        <ActivityIndicator color={colors.white} style={{ marginTop: spacing.xl }} />
        <Text style={styles.status}>{slow ? 'Opening the data saved on this phone…' : 'Starting…'}</Text>
      </Animated.View>
      <Text style={styles.version}>Version {Constants.expoConfig?.version ?? '—'}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.navy, zIndex: 10 },
  // The logo sits exactly in the middle, like the phone's launch image.
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  logo: { width: LOGO, height: LOGO },
  below: { position: 'absolute', left: spacing.xl, right: spacing.xl, top: '50%', marginTop: LOGO / 2 + spacing.lg, alignItems: 'center' },
  name: { color: colors.white, fontSize: 26, fontWeight: '800', letterSpacing: 0.5 },
  tagline: { color: '#c9d4e5', fontSize: 15, marginTop: spacing.xs },
  status: { color: '#c9d4e5', fontSize: 14, marginTop: spacing.sm, textAlign: 'center' },
  version: { position: 'absolute', bottom: 32, alignSelf: 'center', color: '#8fa3c0', fontSize: 13 },
});

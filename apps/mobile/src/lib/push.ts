import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type PushRegistration = { ok: true; token: string } | { ok: false; reason: string };

// Show notifications while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** The EAS project id Expo push needs (app.json → extra.eas.projectId, set by `eas init`). */
function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/**
 * Asks for permission and registers this phone's Expo push token for the
 * signed-in user. Push is optional: the in-app list works without it, so a
 * failure here is reported, not thrown.
 */
export async function registerForPush(): Promise<PushRegistration> {
  try {
    if (!supabase) return { ok: false, reason: 'The app is not configured.' };
    if (!Device.isDevice) return { ok: false, reason: 'Push notifications need a physical phone.' };
    const id = projectId();
    if (!id) return { ok: false, reason: 'Push notifications are not set up for this build (missing EAS project id).' };
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'PM and corrective actions',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'Notifications are switched off for this app in the phone settings.' };
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    if (error) return { ok: false, reason: error.message };
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Stops pushes to this phone for the account that is signing out (best effort; needs a connection). */
export async function unregisterPush(token: string | null): Promise<void> {
  if (!supabase || !token) return;
  try {
    await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // Offline: the token moves to whoever signs in next on this phone.
  }
}

export interface PushData {
  entity_type?: string | null;
  entity_id?: string | null;
}

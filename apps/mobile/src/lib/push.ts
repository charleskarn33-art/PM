import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { sessionClient } from './api/session';

const TOKEN_KEY = 'ipt-pm.push-token';

export type PushStatus = 'unknown' | 'registered' | 'denied' | 'not-configured' | 'unsupported' | 'failed';
export const PUSH_STATUS_TEXT: Record<PushStatus, string> = {
  unknown: 'Checking…',
  registered: 'This phone is registered',
  denied: 'Notifications are turned off for this app in the phone settings',
  'not-configured': 'Push is not set up for this app build yet (in-app notifications still work)',
  unsupported: 'Not available on this device (emulator)',
  failed: 'Could not register this phone; it will try again next time',
};

let status: PushStatus = 'unknown';
const listeners = new Set<() => void>();
const set = (s: PushStatus) => {
  status = s;
  listeners.forEach((l) => l());
};
export const pushStatus = { get: () => status, subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)) };

/** Show notifications that arrive while the app is open. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/**
 * Registers this phone for the signed-in user's push notifications. The
 * server sends them only when push is enabled there; in-app notifications
 * work either way.
 */
export async function registerForPush(): Promise<PushStatus> {
  if (!Device.isDevice) return (set('unsupported'), status);
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return (set('not-configured'), status);
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Work notifications', importance: Notifications.AndroidImportance.HIGH });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return (set('denied'), status);
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await sessionClient?.request('/push-tokens', { method: 'POST', body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android', deviceName: Device.deviceName ?? undefined } });
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    set('registered');
  } catch {
    set('failed');
  }
  return status;
}

/** On sign-out: this phone stops receiving the user's notifications. */
export async function unregisterPush(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (token) {
    await sessionClient?.request('/push-tokens', { method: 'DELETE', body: { token } }).catch(() => undefined);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  }
  set('unknown');
}

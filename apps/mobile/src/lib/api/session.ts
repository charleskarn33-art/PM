import * as SecureStore from 'expo-secure-store';
import { mobileEnv } from '@/lib/env';
import { SessionClient } from './session-client';

/**
 * The app's API session. Tokens are kept in SecureStore (Keychain /
 * Android Keystore), available after the first unlock, never backed up to
 * another device.
 */
export const sessionClient: SessionClient | null = mobileEnv.ok
  ? new SessionClient({
      apiUrl: mobileEnv.env.apiUrl,
      store: {
        getItem: (k) => SecureStore.getItemAsync(k),
        setItem: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
        removeItem: (k) => SecureStore.deleteItemAsync(k),
      },
    })
  : null;

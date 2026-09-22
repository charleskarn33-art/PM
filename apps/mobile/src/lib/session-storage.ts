import { aesDecryptAsync, aesEncryptAsync, AESEncryptionKey, AESKeySize, AESSealedData } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { createEncryptedStorage, type Cipher } from './encrypted-storage';
import { utf8Decode, utf8Encode } from './utf8';

const aesGcm: Cipher = {
  async generateKey() {
    const key = await AESEncryptionKey.generate(AESKeySize.AES256);
    return key.encoded('hex');
  },
  async encrypt(plaintext, keyHex) {
    const key = await AESEncryptionKey.import(keyHex, 'hex');
    const sealed = await aesEncryptAsync(utf8Encode(plaintext), key);
    return sealed.combined('base64');
  },
  async decrypt(ciphertext, keyHex) {
    const key = await AESEncryptionKey.import(keyHex, 'hex');
    const bytes = await aesDecryptAsync(AESSealedData.fromCombined(ciphertext), key, { output: 'bytes' });
    return utf8Decode(bytes);
  },
};

/** Supabase auth storage: AES-GCM ciphertext in SQLite kv-store, key in SecureStore. */
export const sessionStorage = createEncryptedStorage(
  {
    getItemAsync: (k) => SecureStore.getItemAsync(k),
    setItemAsync: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
    deleteItemAsync: (k) => SecureStore.deleteItemAsync(k),
  },
  {
    getItem: (k) => Storage.getItem(k),
    setItem: (k, v) => Storage.setItem(k, v),
    removeItem: (k) => Storage.removeItem(k),
  },
  aesGcm,
  (message, error) => console.warn(message, error),
);

/**
 * Encrypted key/value storage for the Supabase auth session.
 *
 * SecureStore (Keychain / Android Keystore) is size-limited, so a fresh random
 * AES-256-GCM key per value is kept in SecureStore and only the ciphertext is
 * written to the (unencrypted) local key/value store. Dependencies are
 * injected so the logic is testable without native modules.
 */
export interface SecureKeyStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface PlainKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface Cipher {
  generateKey(): Promise<string>;
  encrypt(plaintext: string, key: string): Promise<string>;
  decrypt(ciphertext: string, key: string): Promise<string>;
}

export interface EncryptedStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** SecureStore keys may only contain alphanumerics, ".", "-" and "_". */
export function secureKeyName(key: string): string {
  return `enc_${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export function createEncryptedStorage(
  secure: SecureKeyStore,
  plain: PlainKeyValueStore,
  cipher: Cipher,
  onError: (message: string, error: unknown) => void = () => undefined,
): EncryptedStorage {
  return {
    async getItem(key) {
      const [ciphertext, encKey] = await Promise.all([plain.getItem(key), secure.getItemAsync(secureKeyName(key))]);
      if (!ciphertext || !encKey) return null;
      try {
        return await cipher.decrypt(ciphertext, encKey);
      } catch (error) {
        // Corrupt or foreign data: discard it so the user signs in again
        // instead of the app failing on every launch.
        onError('Stored session could not be decrypted and was cleared.', error);
        await Promise.all([plain.removeItem(key), secure.deleteItemAsync(secureKeyName(key))]);
        return null;
      }
    },
    async setItem(key, value) {
      const encKey = await cipher.generateKey();
      const ciphertext = await cipher.encrypt(value, encKey);
      await secure.setItemAsync(secureKeyName(key), encKey);
      await plain.setItem(key, ciphertext);
    },
    async removeItem(key) {
      await Promise.all([plain.removeItem(key), secure.deleteItemAsync(secureKeyName(key))]);
    },
  };
}

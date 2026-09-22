import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEncryptedStorage, secureKeyName, type Cipher } from './encrypted-storage';
import { readMobileEnv } from './env';
import { utf8Decode, utf8Encode } from './utf8';

// Node AES-256-GCM stand-in for the native expo-crypto implementation.
const nodeAesGcm: Cipher = {
  async generateKey() {
    return randomBytes(32).toString('hex');
  },
  async encrypt(plaintext, keyHex) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    const body = Buffer.concat([c.update(Buffer.from(utf8Encode(plaintext))), c.final()]);
    return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
  },
  async decrypt(ciphertext, keyHex) {
    const buf = Buffer.from(ciphertext, 'base64');
    const d = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return utf8Decode(new Uint8Array(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()])));
  },
};

function memoryStores() {
  const secure = new Map<string, string>();
  const plain = new Map<string, string>();
  return {
    secure,
    plain,
    secureStore: {
      getItemAsync: async (k: string) => secure.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => void secure.set(k, v),
      deleteItemAsync: async (k: string) => void secure.delete(k),
    },
    plainStore: {
      getItem: async (k: string) => plain.get(k) ?? null,
      setItem: async (k: string, v: string) => void plain.set(k, v),
      removeItem: async (k: string) => void plain.delete(k),
    },
  };
}

describe('encrypted session storage', () => {
  const session = JSON.stringify({ access_token: 'eyJ…', user: { email: 'abraham.cole@example.com', name: 'Tiénii ⚡' } });

  it('round-trips values and never stores plaintext outside SecureStore', async () => {
    const m = memoryStores();
    const storage = createEncryptedStorage(m.secureStore, m.plainStore, nodeAesGcm);
    await storage.setItem('sb-abc-auth-token', session);

    expect(await storage.getItem('sb-abc-auth-token')).toBe(session);
    const stored = m.plain.get('sb-abc-auth-token')!;
    expect(stored).not.toContain('access_token');
    expect(m.secure.get(secureKeyName('sb-abc-auth-token'))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('removes both the ciphertext and the key', async () => {
    const m = memoryStores();
    const storage = createEncryptedStorage(m.secureStore, m.plainStore, nodeAesGcm);
    await storage.setItem('k', 'v');
    await storage.removeItem('k');
    expect(m.plain.size + m.secure.size).toBe(0);
    expect(await storage.getItem('k')).toBeNull();
  });

  it('clears tampered data and reports it instead of throwing', async () => {
    const m = memoryStores();
    const errors: string[] = [];
    const storage = createEncryptedStorage(m.secureStore, m.plainStore, nodeAesGcm, (msg) => errors.push(msg));
    await storage.setItem('k', session);
    const tampered = Buffer.from(m.plain.get('k')!, 'base64');
    tampered[20] = (tampered[20] ?? 0) ^ 0xff;
    m.plain.set('k', tampered.toString('base64'));

    expect(await storage.getItem('k')).toBeNull();
    expect(errors).toHaveLength(1);
    expect(m.plain.has('k')).toBe(false);
  });

  it('produces SecureStore-safe key names', () => {
    expect(secureKeyName('sb-abc-auth-token')).toBe('enc_sb-abc-auth-token');
    expect(secureKeyName('a/b:c')).toBe('enc_a_b_c');
  });
});

describe('utf8', () => {
  it.each(['', 'ASCII', 'Grand Cape Mount', 'Tiénii', '⚡ 53.5 V', '𝄞 emoji 🔋'])('round-trips %s', (text) => {
    expect(utf8Decode(utf8Encode(text))).toBe(text);
    expect(Buffer.from(utf8Encode(text)).toString('utf8')).toBe(text);
  });
});

describe('readMobileEnv', () => {
  it('accepts a valid configuration', () => {
    expect(
      readMobileEnv({ EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' }),
    ).toEqual({ ok: true, env: { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' } });
  });
  it('reports missing values and secret keys', () => {
    const missing = readMobileEnv({});
    expect(missing.ok).toBe(false);
    const secret = readMobileEnv({
      EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_123',
    });
    expect(secret).toMatchObject({ ok: false, error: expect.stringMatching(/secret/) });
  });
});

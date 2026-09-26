import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEncryptedStorage, secureKeyName, type Cipher } from './encrypted-storage';
import { readMobileEnv } from './env';
import { mapsUrl, webMapsUrl } from './maps';
import { fitWithin } from './photo-size';
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
  it('needs the API URL; Supabase is optional (legacy sync only)', () => {
    expect(readMobileEnv({ EXPO_PUBLIC_API_URL: 'https://api.example.com/' })).toEqual({
      ok: true,
      env: { apiUrl: 'https://api.example.com', supabaseUrl: null, supabaseKey: null },
    });
    expect(
      readMobileEnv({ EXPO_PUBLIC_API_URL: 'https://api.example.com', EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' }),
    ).toEqual({ ok: true, env: { apiUrl: 'https://api.example.com', supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' } });
    expect(readMobileEnv({})).toMatchObject({ ok: false, error: expect.stringMatching(/EXPO_PUBLIC_API_URL/) });
  });
  it('requires https except for a local development server', () => {
    expect(readMobileEnv({ EXPO_PUBLIC_API_URL: 'http://api.example.com' })).toMatchObject({ ok: false, error: expect.stringMatching(/https/) });
    for (const url of ['http://localhost:3001', 'http://10.0.2.2:3001', 'http://192.168.1.20:3001']) {
      expect(readMobileEnv({ EXPO_PUBLIC_API_URL: url }).ok).toBe(true);
    }
    expect(readMobileEnv({ EXPO_PUBLIC_API_URL: 'not a url' }).ok).toBe(false);
  });
  it('refuses secret keys', () => {
    const secret = readMobileEnv({ EXPO_PUBLIC_API_URL: 'https://api.example.com', EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_123' });
    expect(secret).toMatchObject({ ok: false, error: expect.stringMatching(/secret/) });
  });
});

describe('maps links', () => {
  it('builds platform deep links with an encoded label', () => {
    expect(mapsUrl('ios', 7.32, -11.21, '1301 Tienii')).toBe('maps:0,0?q=1301%20Tienii&ll=7.32,-11.21');
    expect(mapsUrl('android', 7.32, -11.21, '1301 Tienii')).toBe('geo:7.32,-11.21?q=7.32,-11.21(1301%20Tienii)');
    expect(webMapsUrl(7.32, -11.21)).toBe('https://www.google.com/maps/search/?api=1&query=7.32,-11.21');
  });
});

describe('fitWithin', () => {
  it('shrinks the longer side to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 320)).toEqual({ width: 240, height: 320 });
  });
  it('never enlarges a small image', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

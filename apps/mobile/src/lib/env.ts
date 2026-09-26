export interface MobileEnv {
  /** The IPT PM API base URL (without /api/v1). The app talks only to the API, never to the database. */
  apiUrl: string;
}

export type EnvResult = { ok: true; env: MobileEnv } | { ok: false; error: string };

/** Hosts where plain http is acceptable: this machine, the Android emulator's host, private networks (development). */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/**
 * Validates the public configuration. Returns a descriptive error instead of
 * throwing so the app can show a configuration screen.
 */
export function readMobileEnv(source: Record<string, string | undefined>): EnvResult {
  const apiUrl = source.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (!apiUrl) return { ok: false, error: 'Missing configuration: EXPO_PUBLIC_API_URL. See apps/mobile/.env.example.' };
  const m = /^(https?):\/\/([^/:\s]+)(:\d+)?(\/.*)?$/.exec(apiUrl);
  if (!m) return { ok: false, error: 'EXPO_PUBLIC_API_URL is not a valid URL.' };
  if (m[1] === 'http' && !LOCAL_HOST.test(m[2]!)) {
    return { ok: false, error: 'EXPO_PUBLIC_API_URL must use https:// (plain http only for a local development server).' };
  }
  return { ok: true, env: { apiUrl } };
}

// Expo inlines EXPO_PUBLIC_* only when referenced literally.
export const mobileEnv = readMobileEnv({ EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL });

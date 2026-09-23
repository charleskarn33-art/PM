import type { Position } from '@ipt/shared';
import * as Location from 'expo-location';

export interface CapturedPosition {
  position: (Position & { capturedAt: string }) | null;
  /** Why there is no position (shown to the technician). */
  problem: string | null;
}

const FIX_TIMEOUT_MS = 20_000;
/** A last-known fix this recent is accepted when a fresh fix cannot be obtained in time. */
const LAST_KNOWN_MAX_AGE_MS = 2 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** Current GPS position for the PM check-in. Works offline (GPS needs no network). */
export async function capturePosition(): Promise<CapturedPosition> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { position: null, problem: 'Location permission was not given.' };
    if (!(await Location.hasServicesEnabledAsync())) return { position: null, problem: 'Location (GPS) is switched off on this phone.' };
    const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), FIX_TIMEOUT_MS).catch(() => null);
    const fix = fresh ?? (await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).catch(() => null));
    if (!fix) return { position: null, problem: 'No GPS fix could be obtained. Move to open sky and try again.' };
    return {
      position: {
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracyM: fix.coords.accuracy ?? null,
        capturedAt: new Date(fix.timestamp).toISOString(),
      },
      problem: null,
    };
  } catch (e) {
    return { position: null, problem: `Location unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

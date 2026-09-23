import type { Enums } from '../database.types';

export type GeofenceMode = Enums<'geofence_mode'>;
export type GpsStatus = Enums<'gps_status'>;

export interface Position {
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). Mirrors private.distance_m(). */
export function distanceMeters(a: Position, b: Position): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceInput {
  site: { latitude: number | null; longitude: number | null; geofenceRadiusM?: number | null };
  defaultRadiusM: number;
  mode: GeofenceMode;
  position: Position | null;
}

export interface GeofenceResult {
  status: GpsStatus;
  distanceM: number | null;
  radiusM: number;
  mode: GeofenceMode;
  /** Starting PM is not allowed (BLOCK mode and outside / no GPS). */
  blocked: boolean;
  /** The technician must give a reason to continue (REQUIRE_REASON mode). */
  reasonRequired: boolean;
  message: string | null;
}

/**
 * Compares the technician's position with the site. Never blocks unless the
 * configured mode is BLOCK. A site without coordinates cannot be verified and
 * is never blocked. Mirrors the server check in private.check_visit_gps().
 */
export function evaluateGeofence({ site, defaultRadiusM, mode, position }: GeofenceInput): GeofenceResult {
  const radiusM = site.geofenceRadiusM ?? defaultRadiusM;
  const base = { radiusM, mode };
  if (site.latitude == null || site.longitude == null) {
    return {
      ...base,
      status: 'SITE_HAS_NO_COORDINATES',
      distanceM: null,
      blocked: false,
      reasonRequired: false,
      message: 'Site coordinates are not recorded, so your location cannot be verified.',
    };
  }
  if (!position) {
    return {
      ...base,
      status: 'UNAVAILABLE',
      distanceM: null,
      blocked: mode === 'BLOCK',
      reasonRequired: mode === 'REQUIRE_REASON',
      message: 'Your location is unavailable.',
    };
  }
  const distanceM = distanceMeters(position, { latitude: site.latitude, longitude: site.longitude });
  const outside = distanceM > radiusM;
  return {
    ...base,
    status: outside ? 'OUTSIDE_RADIUS' : 'WITHIN_RADIUS',
    distanceM,
    blocked: outside && mode === 'BLOCK',
    reasonRequired: outside && mode === 'REQUIRE_REASON',
    message: outside ? 'Technician is outside the configured site radius.' : null,
  };
}

export function formatDistance(m: number | null): string {
  if (m == null) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
}

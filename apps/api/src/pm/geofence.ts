/**
 * PM start geofence: compares the technician's reported position with the
 * site. Blocks only when the configured mode is BLOCK; a site without
 * coordinates cannot be checked and is never blocked. (Same rules as
 * evaluateGeofence in @ipt/shared, which the phone uses to warn before starting.)
 */
export type GeofenceMode = 'WARN' | 'REQUIRE_REASON' | 'BLOCK';
export type GpsStatus = 'WITHIN_RADIUS' | 'OUTSIDE_RADIUS' | 'UNAVAILABLE' | 'SITE_HAS_NO_COORDINATES';

export interface Position {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: Position, b: Position): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceResult {
  status: GpsStatus;
  distanceM: number | null;
  radiusM: number;
  mode: GeofenceMode;
  blocked: boolean;
  reasonRequired: boolean;
}

export function evaluateGeofence(input: {
  site: { latitude: number | null; longitude: number | null; geofenceRadiusM: number | null };
  defaultRadiusM: number;
  mode: GeofenceMode;
  position: Position | null;
}): GeofenceResult {
  const radiusM = input.site.geofenceRadiusM ?? input.defaultRadiusM;
  const base = { radiusM, mode: input.mode };
  if (input.site.latitude == null || input.site.longitude == null) {
    return { ...base, status: 'SITE_HAS_NO_COORDINATES', distanceM: null, blocked: false, reasonRequired: false };
  }
  if (!input.position) {
    return { ...base, status: 'UNAVAILABLE', distanceM: null, blocked: input.mode === 'BLOCK', reasonRequired: input.mode === 'REQUIRE_REASON' };
  }
  const distanceM = distanceMeters(input.position, { latitude: input.site.latitude, longitude: input.site.longitude });
  const outside = distanceM > radiusM;
  return {
    ...base,
    status: outside ? 'OUTSIDE_RADIUS' : 'WITHIN_RADIUS',
    distanceM,
    blocked: outside && input.mode === 'BLOCK',
    reasonRequired: outside && input.mode === 'REQUIRE_REASON',
  };
}

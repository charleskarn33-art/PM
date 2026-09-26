import { describe, expect, it } from 'vitest';
import { distanceMeters, evaluateGeofence } from './geofence.js';

const site = { latitude: 7.0, longitude: -11.0, geofenceRadiusM: null };
const near = { latitude: 7.0005, longitude: -11.0 }; // ≈ 55 m north
const far = { latitude: 7.01, longitude: -11.0 }; // ≈ 1.1 km north

describe('geofence', () => {
  it('measures great-circle distance', () => {
    expect(distanceMeters(site, near)).toBeCloseTo(55.6, 0);
    expect(distanceMeters(site, site)).toBe(0);
  });

  it('WARN never blocks; REQUIRE_REASON asks for a reason outside; BLOCK refuses outside or without GPS', () => {
    const at = (mode: 'WARN' | 'REQUIRE_REASON' | 'BLOCK', position: typeof near | null) => evaluateGeofence({ site, defaultRadiusM: 100, mode, position });
    expect(at('WARN', near)).toMatchObject({ status: 'WITHIN_RADIUS', blocked: false, reasonRequired: false, radiusM: 100 });
    expect(at('WARN', far)).toMatchObject({ status: 'OUTSIDE_RADIUS', blocked: false, reasonRequired: false });
    expect(at('REQUIRE_REASON', far)).toMatchObject({ blocked: false, reasonRequired: true });
    expect(at('REQUIRE_REASON', null)).toMatchObject({ status: 'UNAVAILABLE', reasonRequired: true });
    expect(at('BLOCK', far)).toMatchObject({ blocked: true });
    expect(at('BLOCK', null)).toMatchObject({ blocked: true });
    expect(at('BLOCK', near)).toMatchObject({ blocked: false });
  });

  it('a site radius overrides the default; a site without coordinates is never blocked', () => {
    expect(evaluateGeofence({ site: { ...site, geofenceRadiusM: 2000 }, defaultRadiusM: 100, mode: 'BLOCK', position: far })).toMatchObject({ status: 'WITHIN_RADIUS', radiusM: 2000 });
    expect(evaluateGeofence({ site: { latitude: null, longitude: null, geofenceRadiusM: null }, defaultRadiusM: 100, mode: 'BLOCK', position: null })).toMatchObject({
      status: 'SITE_HAS_NO_COORDINATES',
      blocked: false,
    });
  });
});

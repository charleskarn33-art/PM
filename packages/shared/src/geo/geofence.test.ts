import { describe, expect, it } from 'vitest';
import { distanceMeters, evaluateGeofence, formatDistance } from './geofence';

const site = { latitude: 7.0, longitude: -11.0 };

describe('distanceMeters', () => {
  it('is zero for the same point and symmetric', () => {
    expect(distanceMeters(site, site)).toBe(0);
    const p = { latitude: 7.001, longitude: -11.001 };
    expect(distanceMeters(site, p)).toBeCloseTo(distanceMeters(p, site), 6);
  });
  it('matches known distances', () => {
    // 0.001° latitude ≈ 111.2 m
    expect(distanceMeters(site, { latitude: 7.001, longitude: -11.0 })).toBeCloseTo(111.2, 0);
    // Monrovia -> Robertsport, straight line ≈ 79 km
    expect(distanceMeters({ latitude: 6.3156, longitude: -10.8074 }, { latitude: 6.7533, longitude: -11.3686 }) / 1000).toBeCloseTo(78.6, 0);
  });
});

describe('evaluateGeofence', () => {
  const near = { latitude: 7.0005, longitude: -11.0 }; // ~56 m
  const far = { latitude: 7.01, longitude: -11.0 }; // ~1.1 km

  it('accepts a technician within the radius in every mode', () => {
    for (const mode of ['WARN', 'REQUIRE_REASON', 'BLOCK'] as const) {
      expect(evaluateGeofence({ site, defaultRadiusM: 100, mode, position: near })).toMatchObject({
        status: 'WITHIN_RADIUS',
        blocked: false,
        reasonRequired: false,
        message: null,
      });
    }
  });

  it('applies the configured behaviour outside the radius', () => {
    const warn = evaluateGeofence({ site, defaultRadiusM: 100, mode: 'WARN', position: far });
    expect(warn).toMatchObject({ status: 'OUTSIDE_RADIUS', blocked: false, reasonRequired: false, message: 'Technician is outside the configured site radius.' });
    expect(evaluateGeofence({ site, defaultRadiusM: 100, mode: 'REQUIRE_REASON', position: far })).toMatchObject({ reasonRequired: true, blocked: false });
    expect(evaluateGeofence({ site, defaultRadiusM: 100, mode: 'BLOCK', position: far })).toMatchObject({ blocked: true });
  });

  it('uses the site radius override', () => {
    const r = evaluateGeofence({ site: { ...site, geofenceRadiusM: 2000 }, defaultRadiusM: 100, mode: 'BLOCK', position: far });
    expect(r).toMatchObject({ status: 'WITHIN_RADIUS', radiusM: 2000, blocked: false });
  });

  it('never blocks when the site has no coordinates; handles missing GPS per mode', () => {
    expect(evaluateGeofence({ site: { latitude: null, longitude: null }, defaultRadiusM: 100, mode: 'BLOCK', position: far })).toMatchObject({
      status: 'SITE_HAS_NO_COORDINATES',
      blocked: false,
    });
    expect(evaluateGeofence({ site, defaultRadiusM: 100, mode: 'WARN', position: null })).toMatchObject({ status: 'UNAVAILABLE', blocked: false });
    expect(evaluateGeofence({ site, defaultRadiusM: 100, mode: 'BLOCK', position: null }).blocked).toBe(true);
    expect(evaluateGeofence({ site, defaultRadiusM: 100, mode: 'REQUIRE_REASON', position: null }).reasonRequired).toBe(true);
  });

  it('formats distances', () => {
    expect(formatDistance(56.4)).toBe('56 m');
    expect(formatDistance(1234)).toBe('1.23 km');
    expect(formatDistance(78600)).toBe('78.6 km');
    expect(formatDistance(null)).toBe('—');
  });
});

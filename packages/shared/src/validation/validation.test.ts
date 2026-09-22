import { describe, expect, it } from 'vitest';
import { toCsv } from '../domain/csv';
import { validateInvite, validateOrgUnit, validateSite } from './organization';

const REGION = '10000000-0000-4000-8000-00000000000a';

describe('validateSite', () => {
  const base = { site_code: '1301', site_name: 'Tienii', region_id: REGION };

  it('accepts a minimal site and normalises optional fields', () => {
    const r = validateSite({ ...base, generator_available: 'on', latitude: '', longitude: '' });
    expect(r).toEqual({
      ok: true,
      value: expect.objectContaining({
        site_code: '1301',
        cluster_id: null,
        county_id: null,
        latitude: null,
        longitude: null,
        generator_available: true,
        solar_available: false,
        status: 'ACTIVE',
        geofence_radius_m: null,
      }),
    });
  });

  it('parses coordinates and geofence', () => {
    const r = validateSite({ ...base, latitude: '6.9', longitude: '-11.2', geofence_radius_m: '150' });
    expect(r.ok && r.value).toMatchObject({ latitude: 6.9, longitude: -11.2, geofence_radius_m: 150 });
  });

  it('reports field errors', () => {
    const r = validateSite({
      site_code: '',
      site_name: 'X',
      region_id: 'nope',
      latitude: '95',
      longitude: 'abc',
      geofence_radius_m: '0',
      status: 'GONE',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(
        ['geofence_radius_m', 'latitude', 'longitude', 'region_id', 'site_code', 'site_name', 'status'].sort(),
      );
    }
  });

  it('requires both coordinates or neither', () => {
    const r = validateSite({ ...base, latitude: '6.9' });
    expect(r).toEqual({ ok: false, errors: { longitude: 'Enter both latitude and longitude, or neither.' } });
  });
});

describe('validateOrgUnit', () => {
  it('uppercases codes and requires a parent when asked', () => {
    expect(validateOrgUnit({ code: 'gcm', name: 'Grand Cape Mount' }, false)).toEqual({
      ok: true,
      value: { code: 'GCM', name: 'Grand Cape Mount', parent_id: null, is_active: true },
    });
    expect(validateOrgUnit({ code: 'C1', name: 'Cluster 1' }, true)).toEqual({
      ok: false,
      errors: { parent_id: 'Select the parent.' },
    });
  });
  it('rejects bad codes', () => {
    const r = validateOrgUnit({ code: 'has space', name: 'Ok' }, false);
    expect(r.ok).toBe(false);
  });
});

describe('validateInvite', () => {
  it('validates email, name and role', () => {
    expect(validateInvite({ email: ' Abraham.Cole@Example.com ', full_name: 'Abraham Cole', role: 'technician', region_id: REGION })).toEqual({
      ok: true,
      value: { email: 'abraham.cole@example.com', full_name: 'Abraham Cole', role: 'technician', region_id: REGION },
    });
    const bad = validateInvite({ email: 'x', full_name: '', role: 'boss' });
    expect(bad.ok ? [] : Object.keys(bad.errors).sort()).toEqual(['email', 'full_name', 'role']);
  });
});

describe('toCsv', () => {
  it('escapes cells, adds a BOM and CRLF line endings', () => {
    const csv = toCsv(
      [{ a: 'Tienii, 1301', b: 'say "hi"', c: null }, { a: '=HYPERLINK("x")', b: 'line\nbreak', c: 3 }],
      [
        { header: 'A', value: (r) => r.a },
        { header: 'B', value: (r) => r.b },
        { header: 'C', value: (r) => r.c },
      ],
    );
    expect(csv).toBe(
      '\uFEFFA,B,C\r\n"Tienii, 1301","say ""hi""",\r\n"\'=HYPERLINK(""x"")","line\nbreak",3\r\n',
    );
  });
  it('does not alter negative numbers', () => {
    expect(toCsv([{ v: -5 }], [{ header: 'V', value: (r) => r.v }])).toBe('\uFEFFV\r\n-5\r\n');
  });
});

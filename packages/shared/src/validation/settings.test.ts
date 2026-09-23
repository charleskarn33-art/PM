import { describe, expect, it } from 'vitest';
import { dcHighLoad } from '../domain/dc';
import { validateConsistencyRule, validateDcThresholds, validateGeofenceSetting } from './settings';

describe('settings validation', () => {
  it('geofence: whole metres > 0 and a known mode', () => {
    expect(validateGeofenceSetting({ radius_m: '150', mode: 'REQUIRE_REASON' })).toEqual({ ok: true, value: { radius_m: 150, mode: 'REQUIRE_REASON' } });
    const bad = validateGeofenceSetting({ radius_m: '0', mode: 'NEVER' });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(['mode', 'radius_m']);
    expect(validateGeofenceSetting({ radius_m: '12.5', mode: 'WARN' }).ok).toBe(false);
  });

  it('DC thresholds: empty means not configured', () => {
    expect(validateDcThresholds({ high_load_kw: '', high_load_current_a: '' })).toEqual({ ok: true, value: { high_load_kw: null, high_load_current_a: null } });
    expect(validateDcThresholds({ high_load_kw: '3.5', high_load_current_a: '' })).toEqual({ ok: true, value: { high_load_kw: 3.5, high_load_current_a: null } });
    expect(validateDcThresholds({ high_load_kw: '-1', high_load_current_a: 'abc' }).ok).toBe(false);
  });

  it('consistency rule: known, different keys and a message', () => {
    const keys = new Set(['a', 'b']);
    expect(validateConsistencyRule({ lhs_key: 'a', operator: '<=', rhs_key: 'b', message: ' x ', is_active: 'true' }, keys)).toEqual({
      ok: true,
      value: { lhs_key: 'a', operator: '<=', rhs_key: 'b', message: 'x', is_active: true },
    });
    const bad = validateConsistencyRule({ lhs_key: 'a', operator: '!=', rhs_key: 'a', message: '' }, keys);
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(['message', 'operator', 'rhs_key']);
    expect(validateConsistencyRule({ lhs_key: 'zzz', operator: '<', rhs_key: 'b', message: 'm' }, keys).ok).toBe(false);
  });
});

describe('dcHighLoad', () => {
  it('flags only against configured thresholds', () => {
    expect(dcHighLoad(5, 100, { high_load_kw: null, high_load_current_a: null })).toEqual({ kw: false, current: false });
    expect(dcHighLoad(5, 100, null)).toEqual({ kw: false, current: false });
    expect(dcHighLoad(5, 100, { high_load_kw: 4, high_load_current_a: 100 })).toEqual({ kw: true, current: false });
    expect(dcHighLoad(null, 101, { high_load_kw: 4, high_load_current_a: 100 })).toEqual({ kw: false, current: true });
  });
});

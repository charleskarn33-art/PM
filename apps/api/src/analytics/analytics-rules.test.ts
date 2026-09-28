import { describe, expect, it } from 'vitest';
import { addMonth, AnalyticsRangeError, batteryFlags, belowTarget, dcFlags, generatorFlags, mean, median, monthIn, monthsBetween, pct, resolveRange, type Thresholds } from './analytics-rules.js';

const NONE: Thresholds = {
  dcLoadKwMax: null,
  rectifierVoltageMin: null,
  batteryVoltageMin: null,
  batteryUnitVoltageMin: null,
  fuelLevelMinPct: null,
  generatorServiceHours: null,
  completionTargetPct: null,
};

describe('months', () => {
  it('steps across years and lists ranges', () => {
    expect(addMonth('2026-11', 3)).toBe('2027-02');
    expect(addMonth('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('places instants in the organisation’s month', () => {
    const at = new Date('2026-09-30T23:30:00Z');
    expect(monthIn('UTC', at)).toBe('2026-09');
    expect(monthIn('Africa/Nairobi', at)).toBe('2026-10');
  });

  it('defaults to the last six months and caps at 24', () => {
    expect(resolveRange({}, '2026-09')).toEqual({ from: '2026-04', to: '2026-09', months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'] });
    expect(resolveRange({ from: '2024-10', to: '2026-09' }, '2026-09').months).toHaveLength(24);
    expect(() => resolveRange({ from: '2024-09', to: '2026-09' }, '2026-09')).toThrow(AnalyticsRangeError);
    expect(() => resolveRange({ from: '2026-10', to: '2026-09' }, '2026-09')).toThrow(AnalyticsRangeError);
  });
});

describe('figures', () => {
  it('rates, means and medians ignore what is unknown', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBeNull();
    expect(mean([1, null, 2, undefined])).toBe(1.5);
    expect(mean([null])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('flags', () => {
  it('flag nothing without configured thresholds', () => {
    expect(dcFlags({ dcPowerKw: 1e6, rectifierVoltageV: 0 }, NONE)).toEqual([]);
    expect(batteryFlags({ batteryVoltageV: 0, minUnitVoltageV: 0 }, NONE)).toEqual([]);
    expect(generatorFlags({ fuelLevelPct: 0, runningHours: 1e6 }, NONE)).toEqual([]);
    expect(belowTarget(0, NONE)).toBeNull();
  });

  it('flag against configured thresholds; missing readings are never flagged', () => {
    const t: Thresholds = { dcLoadKwMax: 2, rectifierVoltageMin: 50, batteryVoltageMin: 48, batteryUnitVoltageMin: 12, fuelLevelMinPct: 25, generatorServiceHours: 250, completionTargetPct: 90 };
    expect(dcFlags({ dcPowerKw: 2.5, rectifierVoltageV: 49 }, t)).toEqual(['DC_LOAD_HIGH', 'RECTIFIER_VOLTAGE_LOW']);
    expect(dcFlags({ dcPowerKw: 2, rectifierVoltageV: null }, t)).toEqual([]);
    expect(batteryFlags({ batteryVoltageV: 47.9, minUnitVoltageV: 11.8 }, t)).toEqual(['BATTERY_VOLTAGE_LOW', 'BATTERY_UNIT_LOW']);
    expect(generatorFlags({ fuelLevelPct: 20, runningHours: 250 }, t)).toEqual(['FUEL_LOW', 'SERVICE_HOURS_REACHED']);
    expect(generatorFlags({ fuelLevelPct: null, runningHours: 249 }, t)).toEqual([]);
    expect(belowTarget(89.9, t)).toBe(true);
    expect(belowTarget(90, t)).toBe(false);
    expect(belowTarget(null, t)).toBeNull();
  });
});

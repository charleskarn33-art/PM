import { describe, expect, it } from 'vitest';
import { monthsBetween, parseAnalyticsParams, pct, phaseImbalancePct } from './analytics-params';

const NOW = new Date(2026, 8, 23); // 23 Sep 2026

describe('parseAnalyticsParams', () => {
  it('defaults to this month and the overview', () => {
    expect(parseAnalyticsParams({}, NOW)).toMatchObject({ tab: 'overview', preset: 'month', from: '2026-09-01', to: '2026-09-30', region: null });
  });
  it('builds whole-month presets ending with the current month', () => {
    expect(parseAnalyticsParams({ period: '3m' }, NOW)).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
    expect(parseAnalyticsParams({ period: '12m' }, NOW)).toMatchObject({ from: '2025-10-01', to: '2026-09-30' });
    expect(parseAnalyticsParams({ period: 'ytd' }, NOW)).toMatchObject({ from: '2026-01-01' });
  });
  it('accepts a valid custom range and rejects bad input', () => {
    expect(parseAnalyticsParams({ period: 'custom', from: '2026-02-01', to: '2026-02-28' }, NOW)).toMatchObject({ preset: 'custom', label: '2026-02-01 to 2026-02-28' });
    expect(parseAnalyticsParams({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }, NOW).preset).toBe('month');
    expect(parseAnalyticsParams({ period: 'custom', from: '2026-05-01', to: '2026-04-01' }, NOW).preset).toBe('month');
    expect(parseAnalyticsParams({ tab: 'hack', region: 'not-a-uuid', period: 'forever' }, NOW)).toMatchObject({ tab: 'overview', region: null, preset: 'month' });
  });
});

describe('analytics helpers', () => {
  it('lists every month in the range, across a year end', () => {
    expect(monthsBetween('2025-11-01', '2026-02-28')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-09-01', '2026-09-30')).toEqual(['2026-09']);
  });
  it('percentages are null when there is nothing to measure', () => {
    expect(pct(3, 4)).toBe(75);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBeNull();
  });
  it('phase imbalance needs at least two recorded phases', () => {
    expect(phaseImbalancePct(10, 14, 36, 3)).toBe(33.3);
    expect(phaseImbalancePct(10, 10, 10, 1)).toBeNull();
    expect(phaseImbalancePct(null, null, null, 0)).toBeNull();
  });
});

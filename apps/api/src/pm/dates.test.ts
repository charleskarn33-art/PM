import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, occurrenceDates, todayIn } from './dates.js';

describe('schedule dates', () => {
  it('recurs from the start date without month-end drift', () => {
    expect(occurrenceDates('MONTHLY', '2026-01-31', 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrenceDates('QUARTERLY', '2026-09-15', 3)).toEqual(['2026-09-15', '2026-12-15', '2027-03-15']);
    expect(occurrenceDates('BIWEEKLY', '2026-09-15', 3)).toEqual(['2026-09-15', '2026-09-29', '2026-10-13']);
    expect(occurrenceDates('AD_HOC', '2026-09-15', 5)).toEqual(['2026-09-15']);
    expect(occurrenceDates('WEEKLY', '2026-09-15', 99)).toHaveLength(24);
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(daysBetween('2026-09-15', '2026-09-22')).toBe(7);
  });

  it('"today" follows the organisation time zone', () => {
    const lateUtc = new Date('2026-09-15T23:30:00Z');
    expect(todayIn('Africa/Monrovia', lateUtc)).toBe('2026-09-15');
    expect(todayIn('Asia/Tokyo', lateUtc)).toBe('2026-09-16');
  });
});

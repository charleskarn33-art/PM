import { describe, expect, it } from 'vitest';
import { formatDateTime, formatNumber, printable, reportFileName } from './report-format';

describe('report formatting', () => {
  it('keeps text printable with the standard PDF fonts', () => {
    expect(printable('Operational ≤ installed → “ok”…')).toBe('Operational <= installed -> "ok"...');
    expect(printable('Voltage × current ÷ 1000 — 53.5 V')).toBe('Voltage × current ÷ 1000 — 53.5 V');
    expect(printable('Emoji 🔋 and 中文')).toBe('Emoji ?? and ??');
    expect(printable(null)).toBe('');
  });
  it('formats numbers, dates and file names', () => {
    expect(formatNumber(2.1400001, 'kW')).toBe('2.14 kW');
    expect(formatNumber(null, 'V')).toBe('—');
    expect(formatDateTime('2026-09-15T10:30:00Z')).toBe('15 Sept 2026, 10:30 UTC');
    expect(reportFileName('1301', 'Tienii (Demo)', '2026-09-15T10:30:00Z')).toBe('PM-1301-Tienii-Demo-2026-09-15.pdf');
  });
});

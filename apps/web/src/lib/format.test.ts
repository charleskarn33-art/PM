import { describe, expect, it } from 'vitest';
import { dueText, formatDate, pct } from './format';

describe('format', () => {
  it('dates and due wording', () => {
    expect(formatDate('2026-09-15')).toBe('15 Sept 2026');
    expect(formatDate(null)).toBe('—');
    expect(dueText('2026-09-15', '2026-09-15')).toBe('Due today');
    expect(dueText('2026-09-18', '2026-09-15')).toBe('Due in 3 days');
    expect(dueText('2026-09-13', '2026-09-15')).toBe('Overdue by 2 days');
    expect(pct(33.33)).toBe('33.3%');
    expect(pct(null)).toBe('—');
  });
});

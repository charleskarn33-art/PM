import { describe, expect, it } from 'vitest';
import { EMPTY_RESPONSE, parseNumberInput, progressBarText, readingUpsert, responseUpsert } from './model';

describe('parseNumberInput', () => {
  it('accepts decimals with dot or comma and clears on empty', () => {
    expect(parseNumberInput('53.5')).toEqual({ value: 53.5 });
    expect(parseNumberInput(' 53,5 ')).toEqual({ value: 53.5 });
    expect(parseNumberInput('-2')).toEqual({ value: -2 });
    expect(parseNumberInput('')).toEqual({ value: null });
  });
  it('rejects non-numbers', () => {
    expect(parseNumberInput('12a').error).toBe('Enter a number');
    expect(parseNumberInput('1.2.3').error).toBe('Enter a number');
  });
});

describe('progressBarText', () => {
  it('renders the requested style', () => {
    expect(progressBarText(80)).toBe('████████░░ 80%');
    expect(progressBarText(0)).toBe('░░░░░░░░░░ 0%');
    expect(progressBarText(100)).toBe('██████████ 100%');
    expect(progressBarText(150)).toBe('██████████ 150%');
  });
});

describe('upsert rows', () => {
  it('sends only client-owned fields; the server fills snapshots and failure flags', () => {
    const row = responseUpsert('v1', { ...EMPTY_RESPONSE('i1'), answer: 'YES', comment: 'ok' }, '2026-09-23T10:00:00Z');
    expect(row).toEqual({
      visit_id: 'v1',
      checklist_item_id: 'i1',
      answer: 'YES',
      numeric_value: null,
      text_value: null,
      selected_options: null,
      date_value: null,
      datetime_value: null,
      comment: 'ok',
      prompt_snapshot: '',
      client_updated_at: '2026-09-23T10:00:00Z',
    });
    expect(row).not.toHaveProperty('is_failure');
    expect(readingUpsert('v1', { reading_field_id: 'f1', numeric_value: 12, text_value: null }, 't')).toEqual({
      visit_id: 'v1',
      reading_field_id: 'f1',
      numeric_value: 12,
      text_value: null,
      label_snapshot: '',
      client_updated_at: 't',
    });
  });
});

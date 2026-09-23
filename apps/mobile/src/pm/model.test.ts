import { describe, expect, it } from 'vitest';
import { EMPTY_RESPONSE, keyedValue, parseNumberInput, phaseCurrents, progressBarText, readingUpsert, responseUpsert, type Field, type Item } from './model';

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

describe('keyed values', () => {
  const field = (id: string, key: string) => ({ id, analytics_key: key }) as Field;
  const item = (id: string, key: string, phase?: number) => ({ id, analytics_key: key, metadata: phase ? { phase_number: phase } : {} }) as Item;
  it('finds values by analytics key in readings or items', () => {
    const fields = [field('v', 'dc.rectifier_voltage_v')];
    const items = [item('dmg', 'solar.damaged_panel_count')];
    const readings = new Map([['v', { reading_field_id: 'v', numeric_value: 53.6, text_value: null }]]);
    const responses = new Map([['dmg', { ...EMPTY_RESPONSE('dmg'), numeric_value: 2 }]]);
    expect(keyedValue('dc.rectifier_voltage_v', fields, items, readings, responses)).toBe(53.6);
    expect(keyedValue('solar.damaged_panel_count', fields, items, readings, responses)).toBe(2);
    expect(keyedValue('dc.load_current_a', fields, items, readings, responses)).toBeNull();
  });
  it('collects entered phase currents in phase order', () => {
    const items = [item('p3', 'dc.phase_current', 3), item('p1', 'dc.phase_current', 1), item('p2', 'dc.phase_current', 2)];
    const responses = new Map([
      ['p3', { ...EMPTY_RESPONSE('p3'), numeric_value: 9.1 }],
      ['p1', { ...EMPTY_RESPONSE('p1'), numeric_value: 12.4 }],
    ]);
    expect(phaseCurrents(items, responses)).toEqual([
      { phase: 1, amps: 12.4 },
      { phase: 3, amps: 9.1 },
    ]);
  });
});

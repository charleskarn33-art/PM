import { describe, expect, it } from 'vitest';
import { validateSchedule } from './schedule';
import { parseOptions, validateChecklistItem, validateReadingField, validateSection } from './template';

const SITE = '40000000-0000-4000-8000-0000000000a1';

describe('validateChecklistItem', () => {
  const base = { code: 'Gen_Burning_Oil', prompt: 'Is The Machine burning Oil?', response_type: 'YES_NO_NA', is_active: 'on' };

  it('maps the failure rule and evidence settings', () => {
    const r = validateChecklistItem({
      ...base,
      failure_on: 'YES',
      failure_severity: 'HIGH',
      requires_photo_on_failure: 'on',
      requires_comment_on_failure: 'on',
      is_required: 'on',
      allow_not_applicable: 'on',
    });
    expect(r).toEqual({
      ok: true,
      value: expect.objectContaining({
        code: 'gen_burning_oil',
        creates_failure_on_yes: true,
        creates_failure_on_no: false,
        failure_severity: 'HIGH',
        requires_photo_on_failure: true,
        requires_comment_on_failure: true,
        is_required: true,
      }),
    });
  });

  it('supports answer-based evidence (fire extinguisher photo on YES)', () => {
    const r = validateChecklistItem({ ...base, photo_on_YES: 'on', comment_on_NA: 'on', photo_instructions: 'Show expiry date' });
    expect(r.ok && r.value).toMatchObject({ requires_photo_on_answer: ['YES'], requires_comment_on_answer: ['N/A'] });
  });

  it('rejects inconsistent configuration', () => {
    const r = validateChecklistItem({ ...base, response_type: 'NUMBER', failure_on: 'NO', min_value: '10', max_value: '5' });
    expect(r.ok ? [] : Object.keys(r.errors).sort()).toEqual(['failure_on', 'max_value']);
    const select = validateChecklistItem({ ...base, response_type: 'SELECT', options: 'Only one' });
    expect(select.ok ? [] : Object.keys(select.errors)).toEqual(['options']);
    const range = validateChecklistItem({ ...base, min_value: '1' });
    expect(range.ok ? [] : Object.keys(range.errors)).toEqual(['min_value']);
  });

  it('drops evidence-on-failure flags when there is no failure rule', () => {
    const r = validateChecklistItem({ ...base, requires_photo_on_failure: 'on' });
    expect(r.ok && r.value.requires_photo_on_failure).toBe(false);
  });
});

describe('validateReadingField', () => {
  it('accepts numeric readings with ranges and select readings with options', () => {
    expect(validateReadingField({ code: 'fuel_level', label: 'Fuel Level (%)', value_type: 'NUMBER', min_value: '0', max_value: '100', is_required: 'on' }))
      .toMatchObject({ ok: true, value: { min_value: 0, max_value: 100, is_required: true, is_integer: false } });
    expect(validateReadingField({ code: 'ctrl', label: 'NCU / CSB / TRION Model', value_type: 'SELECT', options: 'NCU\nCSB\nTRION' }))
      .toMatchObject({ ok: true, value: { options: ['NCU', 'CSB', 'TRION'] } });
  });
  it('rejects ranges on text readings', () => {
    expect(validateReadingField({ code: 'x', label: 'Model', value_type: 'TEXT', max_value: '3' }).ok).toBe(false);
  });
});

describe('validateSection and parseOptions', () => {
  it('validates names and parses option lists', () => {
    expect(validateSection({ name: 'Solar', allow_not_applicable: 'on', is_active: 'on' })).toEqual({
      ok: true,
      value: { name: 'Solar', description: null, allow_not_applicable: true, is_active: true },
    });
    expect(validateSection({ name: 'S' }).ok).toBe(false);
    expect(parseOptions(' A, B\nB\n\nC ')).toEqual(['A', 'B', 'C']);
  });
});

describe('validateSchedule', () => {
  it('expands recurrence into scheduled and due dates', () => {
    const r = validateSchedule({ site_id: SITE, frequency: 'MONTHLY', start_date: '2026-10-01', occurrences: '3', due_days: '7' });
    expect(r.ok && r.value.occurrences).toEqual([
      { scheduled_date: '2026-10-01', due_date: '2026-10-08' },
      { scheduled_date: '2026-11-01', due_date: '2026-11-08' },
      { scheduled_date: '2026-12-01', due_date: '2026-12-08' },
    ]);
  });
  it('validates inputs', () => {
    const r = validateSchedule({ site_id: 'x', frequency: 'DAILY', start_date: '2026-13-40', occurrences: '99', due_days: '-1' });
    expect(r.ok ? [] : Object.keys(r.errors).sort()).toEqual(['due_days', 'frequency', 'occurrences', 'site_id', 'start_date']);
  });
});

import { describe, expect, it } from 'vitest';
import { isFailure, numberError, submissionMessage, visitIssues, visitProgress, type ChecklistItem, type ChecklistState } from './checklist';
import { addMonths, occurrenceDates } from './recurrence';

const item = (id: string, section: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  section_id: section,
  prompt: id,
  response_type: 'YES_NO_NA',
  is_required: true,
  is_active: true,
  allow_not_applicable: true,
  creates_failure_on_no: false,
  creates_failure_on_yes: false,
  requires_comment_on_failure: false,
  requires_photo_on_failure: false,
  requires_comment_on_answer: [],
  requires_photo_on_answer: [],
  analytics_key: null,
  ...over,
});

const base: ChecklistState = {
  sections: [
    { id: 'g', code: 'GENERATOR', name: 'Generator', is_active: true, allow_not_applicable: true, sort_order: 1 },
    { id: 's', code: 'SOLAR', name: 'Solar', is_active: true, allow_not_applicable: true, sort_order: 2 },
  ],
  items: [
    item('burning_oil', 'g', { creates_failure_on_yes: true, requires_comment_on_failure: true, requires_photo_on_failure: true }),
    item('automation', 'g', { creates_failure_on_no: true }),
    item('phase1', 'g', { response_type: 'NUMBER', is_required: false }),
    item('water', 'g', { requires_comment_on_answer: ['YES'] }),
    item('controller', 's', { creates_failure_on_no: true }),
    item('old', 'g', { is_active: false }),
  ],
  readingFields: [
    { id: 'hours', section_id: 'g', label: 'Running Hours', value_type: 'NUMBER', is_required: true, is_active: true, analytics_key: null },
    { id: 'panels', section_id: 's', label: 'Panels Installed', value_type: 'NUMBER', is_required: true, is_active: true, analytics_key: 'solar.panels_installed' },
    { id: 'ok', section_id: 's', label: 'Panels Operational', value_type: 'NUMBER', is_required: false, is_active: true, analytics_key: 'solar.panels_operational' },
  ],
  responses: [],
  readings: [],
  notApplicableSections: [],
};

const resp = (id: string, over: Record<string, unknown>) => ({
  checklist_item_id: id,
  answer: null,
  numeric_value: null,
  text_value: null,
  selected_options: null,
  date_value: null,
  datetime_value: null,
  comment: null,
  ...over,
});

describe('visitProgress', () => {
  it('counts required items and readings; ignores optional and inactive items', () => {
    expect(visitProgress(base)).toMatchObject({ completionPct: 0, failureCount: 0 });
    const p = visitProgress({
      ...base,
      responses: [resp('automation', { answer: 'NO' }), resp('phase1', { numeric_value: 4 })],
      readings: [{ reading_field_id: 'hours', numeric_value: 1520, text_value: null }],
    });
    // required: burning_oil, automation, water, controller, hours, panels = 6; done: automation, hours
    expect(p.completionPct).toBe(33.33);
    expect(p.failureCount).toBe(1);
    expect(p.sections.map((s) => [s.code, s.required, s.done])).toEqual([
      ['GENERATOR', 4, 2],
      ['SOLAR', 2, 0],
    ]);
  });

  it('excludes N/A sections from completion and failures', () => {
    const p = visitProgress({
      ...base,
      notApplicableSections: ['SOLAR'],
      responses: [resp('controller', { answer: 'NO' })],
    });
    expect(p.failureCount).toBe(0);
    expect(p.sections.find((s) => s.code === 'SOLAR')?.notApplicable).toBe(true);
    expect(visitProgress({ ...base, sections: [], items: [], readingFields: [] }).completionPct).toBe(100);
  });
});

describe('visitIssues', () => {
  it('reports missing answers, comments and photos', () => {
    const issues = visitIssues({
      ...base,
      notApplicableSections: ['SOLAR'],
      responses: [resp('burning_oil', { answer: 'YES' }), resp('water', { answer: 'YES' }), resp('automation', { answer: 'N/A' })],
      readings: [{ reading_field_id: 'hours', numeric_value: 10, text_value: null }],
    });
    expect(issues.map((i) => `${i.refId}:${i.issue}`)).toEqual([
      'burning_oil:COMMENT_REQUIRED',
      'burning_oil:PHOTO_REQUIRED',
      'water:COMMENT_REQUIRED',
    ]);
  });

  it('respects the photo enforcement setting and attached photos', () => {
    const state = { ...base, notApplicableSections: ['SOLAR'], responses: [resp('burning_oil', { answer: 'YES', comment: 'smoke' })] };
    expect(visitIssues(state).some((i) => i.issue === 'PHOTO_REQUIRED')).toBe(true);
    expect(visitIssues({ ...state, photoCounts: { burning_oil: 1 } }).some((i) => i.issue === 'PHOTO_REQUIRED')).toBe(false);
    expect(visitIssues({ ...state, enforcePhotoRequirements: false }).some((i) => i.issue === 'PHOTO_REQUIRED')).toBe(false);
  });
});

describe('consistency rules', () => {
  const rules = [
    { id: 'r1', lhs_key: 'solar.panels_operational', operator: '<=', rhs_key: 'solar.panels_installed', message: 'Operational > installed', is_active: true },
  ];
  const withPanels = (installed: number, operational: number) => ({
    ...base,
    consistencyRules: rules,
    readings: [
      { reading_field_id: 'panels', numeric_value: installed, text_value: null },
      { reading_field_id: 'ok', numeric_value: operational, text_value: null },
    ],
  });
  it('reports contradicting values in applicable sections only', () => {
    expect(visitIssues(withPanels(10, 12)).filter((i) => i.issue === 'INCONSISTENT')).toEqual([
      { sectionCode: 'SOLAR', refType: 'rule', refId: 'r1', label: 'Operational > installed', issue: 'INCONSISTENT' },
    ]);
    expect(visitIssues(withPanels(10, 10)).some((i) => i.issue === 'INCONSISTENT')).toBe(false);
    expect(visitIssues({ ...withPanels(10, 12), notApplicableSections: ['SOLAR'] }).some((i) => i.issue === 'INCONSISTENT')).toBe(false);
    expect(visitIssues({ ...withPanels(10, 12), consistencyRules: [{ ...rules[0]!, is_active: false }] }).length).toBeGreaterThan(0);
    expect(visitIssues({ ...withPanels(10, 12), consistencyRules: [{ ...rules[0]!, is_active: false }] }).some((i) => i.issue === 'INCONSISTENT')).toBe(false);
  });
});

describe('helpers', () => {
  it('evaluates failure polarity', () => {
    const oil = item('x', 'g', { creates_failure_on_yes: true });
    expect(isFailure(oil, 'YES')).toBe(true);
    expect(isFailure(oil, 'NO')).toBe(false);
    expect(isFailure(oil, 'N/A')).toBe(false);
  });
  it('validates numbers against configured rules', () => {
    expect(numberError('Fuel Level (%)', 120, { min: 0, max: 100 })).toBe('"Fuel Level (%)" must be at most 100');
    expect(numberError('Modules', 2.5, { integer: true })).toBe('"Modules" must be a whole number');
    expect(numberError('Voltage', 53.5, { min: 0 })).toBeNull();
    expect(numberError('X', Number.NaN, {})).toBe('"X" must be a number');
  });
  it('formats the submission message', () => {
    expect(submissionMessage(3)).toBe('Unable to submit because 3 required fields are incomplete.');
    expect(submissionMessage(1)).toBe('Unable to submit because 1 required field is incomplete.');
    expect(submissionMessage(0)).toBe('Ready to submit.');
  });
});

describe('recurrence', () => {
  it('generates weekly and monthly occurrences', () => {
    expect(occurrenceDates('WEEKLY', '2026-09-28', 3)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(occurrenceDates('QUARTERLY', '2026-09-15', 3)).toEqual(['2026-09-15', '2026-12-15', '2027-03-15']);
    expect(occurrenceDates('AD_HOC', '2026-09-15', 5)).toEqual(['2026-09-15']);
  });
  it('clamps month ends without drifting', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(occurrenceDates('MONTHLY', '2026-01-31', 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(addMonths('2027-12-15', 2)).toBe('2028-02-15');
  });
  it('rejects malformed start dates', () => {
    expect(() => occurrenceDates('MONTHLY', '15/09/2026', 1)).toThrow();
  });
});

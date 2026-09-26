import { describe, expect, it } from 'vitest';
import {
  consistencyIssues,
  isEmptyResponse,
  isFailure,
  normalizeReading,
  normalizeResponse,
  visitIssues,
  visitProgress,
  type EngineField,
  type EngineItem,
  type EngineSection,
  type ResponseValues,
  type VisitState,
} from './engine.js';

const item = (over: Partial<EngineItem> = {}): EngineItem => ({
  id: 'i1',
  sectionId: 's1',
  prompt: 'Is Automation Working?',
  responseType: 'YES_NO_NA',
  options: [],
  allowNotApplicable: true,
  isRequired: true,
  minValue: null,
  maxValue: null,
  isInteger: false,
  failureOnAnswer: null,
  requiresPhotoOnFailure: false,
  requiresCommentOnFailure: false,
  photoOnAnswers: [],
  commentOnAnswers: [],
  analyticsKey: null,
  isActive: true,
  ...over,
});
const field = (over: Partial<EngineField> = {}): EngineField => ({
  id: 'f1',
  sectionId: 's1',
  label: 'Fuel Level (%)',
  valueType: 'NUMBER',
  options: [],
  isRequired: true,
  minValue: 0,
  maxValue: 100,
  isInteger: false,
  analyticsKey: null,
  isActive: true,
  ...over,
});
const resp = (over: Partial<ResponseValues> = {}): ResponseValues => ({
  answer: null,
  numericValue: null,
  textValue: null,
  selectedOptions: null,
  dateValue: null,
  datetimeValue: null,
  comment: null,
  ...over,
});
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

describe('normalizeResponse', () => {
  it('YES/NO/N/A items take only an answer', () => {
    expect(ok(normalizeResponse(item(), { answer: 'NO', comment: '  bad contact ' }))).toMatchObject({ answer: 'NO', comment: 'bad contact' });
    expect(err(normalizeResponse(item(), { numericValue: 3 }))).toMatch(/Yes, No or N\/A/);
    expect(err(normalizeResponse(item({ allowNotApplicable: false }), { answer: 'NA' }))).toMatch(/cannot be answered N\/A/);
  });

  it('numbers respect only the configured limits', () => {
    const fuel = item({ prompt: 'Fuel', responseType: 'NUMBER', minValue: 0, maxValue: 100 });
    expect(ok(normalizeResponse(fuel, { numericValue: 12.7 })).numericValue).toBe(12.7);
    expect(err(normalizeResponse(fuel, { numericValue: 101 }))).toMatch(/at most 100/);
    expect(err(normalizeResponse(fuel, { numericValue: -1 }))).toMatch(/at least 0/);
    expect(err(normalizeResponse(item({ responseType: 'NUMBER', isInteger: true }), { numericValue: 2.5 }))).toMatch(/whole number/);
    // No limits configured: any finite number.
    expect(ok(normalizeResponse(item({ responseType: 'NUMBER' }), { numericValue: 987654.321 })).numericValue).toBe(987654.321);
    expect(err(normalizeResponse(fuel, { answer: 'YES' }))).toMatch(/takes a number/);
  });

  it('select, multi-select, text, dates and N/A', () => {
    const sel = item({ responseType: 'SELECT', options: ['NCU', 'CSB', 'TRION'] });
    expect(ok(normalizeResponse(sel, { textValue: 'CSB' })).textValue).toBe('CSB');
    expect(err(normalizeResponse(sel, { textValue: 'XYZ' }))).toMatch(/not one of the options/);
    const multi = item({ responseType: 'MULTI_SELECT', options: ['A', 'B'] });
    expect(ok(normalizeResponse(multi, { selectedOptions: ['A', 'A', 'B'] })).selectedOptions).toEqual(['A', 'B']);
    expect(err(normalizeResponse(multi, { selectedOptions: ['C'] }))).toMatch(/not one of the options/);
    expect(ok(normalizeResponse(item({ responseType: 'TEXT' }), { textValue: '  ' })).textValue).toBeNull();
    expect(ok(normalizeResponse(item({ responseType: 'DATE' }), { dateValue: '2026-09-15' })).dateValue).toBe('2026-09-15');
    expect(err(normalizeResponse(item({ responseType: 'DATE' }), { dateValue: '2026-02-30' }))).toMatch(/YYYY-MM-DD/);
    expect(ok(normalizeResponse(item({ responseType: 'DATETIME' }), { datetimeValue: '2026-09-15T10:30:00+01:00' })).datetimeValue).toBe('2026-09-15T09:30:00.000Z');
    expect(ok(normalizeResponse(item({ responseType: 'NUMBER' }), { answer: 'NA' })).answer).toBe('NA');
    expect(err(normalizeResponse(item({ responseType: 'NUMBER' }), { answer: 'NA', numericValue: 1 }))).toMatch(/either N\/A or a value/);
    expect(err(normalizeResponse(item({ responseType: 'PHOTO' }), { textValue: 'x' }))).toMatch(/with a photo/);
  });

  it('an answer with nothing set clears the response', () => {
    expect(isEmptyResponse(ok(normalizeResponse(item(), {})))).toBe(true);
    expect(isEmptyResponse(ok(normalizeResponse(item(), { comment: 'x' })))).toBe(false);
  });
});

describe('normalizeReading', () => {
  it('checks type and configured limits', () => {
    expect(ok(normalizeReading(field(), { numericValue: 12.7 }))).toEqual({ numericValue: 12.7, textValue: null });
    expect(err(normalizeReading(field(), { numericValue: 120 }))).toMatch(/at most 100/);
    expect(err(normalizeReading(field(), { textValue: 'full' }))).toMatch(/takes a number/);
    const oil = field({ label: 'Oil Pressure', valueType: 'TEXT', minValue: null, maxValue: null });
    expect(ok(normalizeReading(oil, { textValue: 'Okay' })).textValue).toBe('Okay');
    expect(err(normalizeReading(oil, { numericValue: 3 }))).toMatch(/takes text/);
  });
});

describe('failure rules and evidence', () => {
  const burning = item({ prompt: 'Is The Machine burning Oil?', failureOnAnswer: 'YES', requiresCommentOnFailure: true, requiresPhotoOnFailure: true });
  it('the configured answer is the failure', () => {
    expect(isFailure(burning, 'YES')).toBe(true);
    expect(isFailure(burning, 'NO')).toBe(false);
    expect(isFailure(burning, 'NA')).toBe(false);
    expect(isFailure(item(), 'NO')).toBe(false);
  });
});

describe('visit issues and progress', () => {
  const sections: EngineSection[] = [
    { id: 's1', code: 'GENERATOR', name: 'Generator', sortOrder: 1, isActive: true, allowNotApplicable: true },
    { id: 's2', code: 'DC_SYSTEM', name: 'DC System', sortOrder: 2, isActive: true, allowNotApplicable: false },
  ];
  const items: EngineItem[] = [
    item({ id: 'auto', failureOnAnswer: 'NO', requiresCommentOnFailure: true, requiresPhotoOnFailure: true }),
    item({ id: 'ext', prompt: 'Fire Extinguisher?', sectionId: 's2', failureOnAnswer: 'NO', photoOnAnswers: ['YES'] }),
    item({ id: 'phase', prompt: 'Phase 1 A', sectionId: 's2', responseType: 'NUMBER', isRequired: false }),
    item({ id: 'old', prompt: 'Retired question', isActive: false }),
  ];
  const fields: EngineField[] = [
    field({ id: 'installed', sectionId: 's2', label: 'DC Modules Installed', minValue: 0, maxValue: null, isInteger: true, analyticsKey: 'dc.installed' }),
    field({ id: 'operational', sectionId: 's2', label: 'DC Modules Operational', minValue: 0, maxValue: null, isInteger: true, analyticsKey: 'dc.operational' }),
  ];
  const rules = [{ id: 'r1', lhsKey: 'dc.operational', operator: '<=', rhsKey: 'dc.installed', message: 'Operational cannot exceed installed.', isActive: true }];
  const state = (over: Partial<VisitState> = {}): VisitState => ({
    sections,
    items,
    fields,
    rules,
    responses: new Map(),
    readings: new Map(),
    photoCounts: new Map(),
    notApplicableSections: [],
    ...over,
  });

  it('an empty visit: every required answer and reading is missing, 0%', () => {
    const s = state();
    expect(visitIssues(s).map((i) => `${i.kind}:${i.refId}`)).toEqual(['REQUIRED:auto', 'REQUIRED:ext', 'REQUIRED:installed', 'REQUIRED:operational']);
    expect(visitProgress(s)).toMatchObject({ completionPct: 0, failureCount: 0 });
  });

  it('a failure needs its comment and photo; an answer can need a photo; counts failures', () => {
    const s = state({
      responses: new Map([
        ['auto', resp({ answer: 'NO' })],
        ['ext', resp({ answer: 'YES' })],
      ]),
      readings: new Map([
        ['installed', { numericValue: 3, textValue: null }],
        ['operational', { numericValue: 3, textValue: null }],
      ]),
    });
    expect(visitIssues(s).map((i) => `${i.kind}:${i.refId}`)).toEqual(['COMMENT_REQUIRED:auto', 'PHOTO_REQUIRED:auto', 'PHOTO_REQUIRED:ext']);
    const p = visitProgress(s);
    expect(p).toMatchObject({ completionPct: 100, failureCount: 1 });
    expect(p.sections.map((x) => [x.code, x.required, x.done, x.failures])).toEqual([
      ['GENERATOR', 1, 1, 1],
      ['DC_SYSTEM', 3, 3, 0],
    ]);
    const done = state({
      ...s,
      responses: new Map([
        ['auto', resp({ answer: 'NO', comment: 'Controller fault' })],
        ['ext', resp({ answer: 'YES' })],
      ]),
      readings: s.readings,
      photoCounts: new Map([
        ['auto', 1],
        ['ext', 2],
      ]),
    });
    expect(visitIssues(done)).toEqual([]);
  });

  it('not-applicable sections drop out; completion never rounds up to 100', () => {
    const s = state({ notApplicableSections: ['GENERATOR'] });
    expect(visitIssues(s).some((i) => i.sectionCode === 'GENERATOR')).toBe(false);
    expect(visitProgress(s).sections[0]).toMatchObject({ code: 'GENERATOR', required: 0, notApplicable: true });

    const many = Array.from({ length: 3 }, (_, n) => item({ id: `q${n}`, sectionId: 's2' }));
    const three = state({ items: many, fields: [], responses: new Map([['q0', resp({ answer: 'YES' })]]) });
    expect(visitProgress(three).completionPct).toBe(33.33);
    const almost = Array.from({ length: 10001 }, (_, n) => item({ id: `z${n}`, sectionId: 's2' }));
    const r = new Map(almost.slice(0, 10000).map((i) => [i.id, resp({ answer: 'YES' })]));
    expect(visitProgress(state({ items: almost, fields: [], responses: r })).completionPct).toBe(99.99);
  });

  it('extra required values (battery units) count and block like readings of their section', () => {
    const extraRequired = [
      { sectionCode: 'DC_SYSTEM', refId: '1', label: 'Battery 1 voltage', done: true },
      { sectionCode: 'DC_SYSTEM', refId: '2', label: 'Battery 2 voltage', done: false },
    ];
    const s = state({ extraRequired, items: [], fields: [] });
    expect(visitIssues(s)).toEqual([{ sectionCode: 'DC_SYSTEM', kind: 'REQUIRED', refType: 'battery_unit', refId: '2', label: 'Battery 2 voltage' }]);
    expect(visitProgress(s).completionPct).toBe(50);
    const na = state({ extraRequired, items: [], fields: [], sections: [{ ...sections[1]!, allowNotApplicable: true }], notApplicableSections: ['DC_SYSTEM'] });
    expect(visitIssues(na)).toEqual([]);
    expect(visitProgress(na).completionPct).toBe(100);
  });

  it('consistency rules compare keyed values', () => {
    const s = state({
      readings: new Map([
        ['installed', { numericValue: 3, textValue: null }],
        ['operational', { numericValue: 4, textValue: null }],
      ]),
    });
    expect(consistencyIssues(s)).toEqual([{ sectionCode: 'DC_SYSTEM', kind: 'INCONSISTENT', refType: 'rule', refId: 'r1', label: 'Operational cannot exceed installed.' }]);
    expect(consistencyIssues(state({ ...s, rules: [{ ...rules[0]!, isActive: false }] }))).toEqual([]);
  });
});

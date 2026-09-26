/**
 * The PM engine's rules, as pure functions (no database): validating an
 * answer or reading against its template definition, failure rules, what
 * blocks completion, and completion %. The services store what these return;
 * the mobile app will run the same rules offline (Phase 7).
 */

export type AnswerCode = 'YES' | 'NO' | 'NA';
export type ResponseTypeCode = 'YES_NO_NA' | 'NUMBER' | 'TEXT' | 'SELECT' | 'MULTI_SELECT' | 'DATE' | 'DATETIME' | 'PHOTO';

export interface EngineSection {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  allowNotApplicable: boolean;
}

export interface EngineItem {
  id: string;
  sectionId: string;
  prompt: string;
  responseType: ResponseTypeCode;
  options: string[];
  allowNotApplicable: boolean;
  isRequired: boolean;
  minValue: number | null;
  maxValue: number | null;
  isInteger: boolean;
  failureOnAnswer: 'YES' | 'NO' | null;
  requiresPhotoOnFailure: boolean;
  requiresCommentOnFailure: boolean;
  photoOnAnswers: AnswerCode[];
  commentOnAnswers: AnswerCode[];
  analyticsKey: string | null;
  isActive: boolean;
}

export interface EngineField {
  id: string;
  sectionId: string;
  label: string;
  valueType: 'NUMBER' | 'TEXT' | 'SELECT';
  options: string[];
  isRequired: boolean;
  minValue: number | null;
  maxValue: number | null;
  isInteger: boolean;
  analyticsKey: string | null;
  isActive: boolean;
}

export interface EngineRule {
  id: string;
  lhsKey: string;
  operator: string;
  rhsKey: string;
  message: string;
  isActive: boolean;
}

/** A stored answer. Only the value matching the item's type is set. */
export interface ResponseValues {
  answer: AnswerCode | null;
  numericValue: number | null;
  textValue: string | null;
  selectedOptions: string[] | null;
  /** YYYY-MM-DD */
  dateValue: string | null;
  /** ISO 8601 */
  datetimeValue: string | null;
  comment: string | null;
}

export interface ReadingValues {
  numericValue: number | null;
  textValue: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const blank = (s: string | null | undefined) => s == null || s.trim() === '';
const EMPTY: ResponseValues = { answer: null, numericValue: null, textValue: null, selectedOptions: null, dateValue: null, datetimeValue: null, comment: null };

function numberError(label: string, value: number, rule: { minValue: number | null; maxValue: number | null; isInteger: boolean }): string | null {
  if (!Number.isFinite(value)) return `"${label}" must be a number.`;
  if (rule.minValue != null && value < rule.minValue) return `"${label}" must be at least ${rule.minValue}.`;
  if (rule.maxValue != null && value > rule.maxValue) return `"${label}" must be at most ${rule.maxValue}.`;
  if (rule.isInteger && !Number.isInteger(value)) return `"${label}" must be a whole number.`;
  return null;
}

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/**
 * Checks an answer against its item and keeps only the value for the item's
 * type. N/A (answer "NA") is accepted for any type when the item allows it;
 * the comment is kept for every type.
 */
export function normalizeResponse(item: EngineItem, input: Partial<ResponseValues>): Result<ResponseValues> {
  const label = item.prompt;
  const out: ResponseValues = { ...EMPTY, comment: blank(input.comment) ? null : input.comment!.trim() };
  const given = (k: keyof ResponseValues) => input[k] !== undefined && input[k] !== null && k !== 'comment';
  const others = (allowed: (keyof ResponseValues)[]) =>
    (['answer', 'numericValue', 'textValue', 'selectedOptions', 'dateValue', 'datetimeValue'] as const).filter((k) => !allowed.includes(k) && given(k));

  if (input.answer === 'NA') {
    if (!item.allowNotApplicable) return { ok: false, error: `"${label}" cannot be answered N/A.` };
    if (others(['answer']).length) return { ok: false, error: `"${label}": give either N/A or a value, not both.` };
    return { ok: true, value: { ...out, answer: 'NA' } };
  }

  switch (item.responseType) {
    case 'YES_NO_NA': {
      if (others(['answer']).length) return { ok: false, error: `"${label}" is answered Yes, No or N/A.` };
      if (input.answer != null && input.answer !== 'YES' && input.answer !== 'NO') return { ok: false, error: `"${label}" is answered Yes, No or N/A.` };
      return { ok: true, value: { ...out, answer: input.answer ?? null } };
    }
    case 'NUMBER': {
      if (others(['numericValue']).length) return { ok: false, error: `"${label}" takes a number.` };
      if (input.numericValue == null) return { ok: true, value: out };
      const error = numberError(label, input.numericValue, item);
      return error ? { ok: false, error } : { ok: true, value: { ...out, numericValue: input.numericValue } };
    }
    case 'TEXT': {
      if (others(['textValue']).length) return { ok: false, error: `"${label}" takes text.` };
      const text = blank(input.textValue) ? null : input.textValue!.trim();
      if (text && text.length > 2000) return { ok: false, error: `"${label}" must be at most 2000 characters.` };
      return { ok: true, value: { ...out, textValue: text } };
    }
    case 'SELECT': {
      if (others(['textValue']).length) return { ok: false, error: `"${label}" takes one of its options.` };
      const text = blank(input.textValue) ? null : input.textValue!.trim();
      if (text && !item.options.includes(text)) return { ok: false, error: `"${label}": "${text}" is not one of the options.` };
      return { ok: true, value: { ...out, textValue: text } };
    }
    case 'MULTI_SELECT': {
      if (others(['selectedOptions']).length) return { ok: false, error: `"${label}" takes a list of its options.` };
      const list = input.selectedOptions ?? null;
      if (list == null || list.length === 0) return { ok: true, value: out };
      const unknown = list.filter((o) => !item.options.includes(o));
      if (unknown.length) return { ok: false, error: `"${label}": "${unknown[0]}" is not one of the options.` };
      return { ok: true, value: { ...out, selectedOptions: [...new Set(list)] } };
    }
    case 'DATE': {
      if (others(['dateValue']).length) return { ok: false, error: `"${label}" takes a date.` };
      if (input.dateValue == null) return { ok: true, value: out };
      if (!isIsoDate(input.dateValue)) return { ok: false, error: `"${label}" must be a date (YYYY-MM-DD).` };
      return { ok: true, value: { ...out, dateValue: input.dateValue } };
    }
    case 'DATETIME': {
      if (others(['datetimeValue']).length) return { ok: false, error: `"${label}" takes a date and time.` };
      if (input.datetimeValue == null) return { ok: true, value: out };
      if (Number.isNaN(Date.parse(input.datetimeValue)) || !/T\d{2}:\d{2}/.test(input.datetimeValue)) {
        return { ok: false, error: `"${label}" must be a date and time (ISO 8601).` };
      }
      return { ok: true, value: { ...out, datetimeValue: new Date(input.datetimeValue).toISOString() } };
    }
    case 'PHOTO': {
      // Answered by attaching photos; only N/A or a comment are stored.
      if (others([]).length) return { ok: false, error: `"${label}" is answered with a photo.` };
      return { ok: true, value: out };
    }
  }
}

/** Checks a reading against its field. */
export function normalizeReading(field: EngineField, input: Partial<ReadingValues>): Result<ReadingValues> {
  const label = field.label;
  if (field.valueType === 'NUMBER') {
    if (input.textValue != null) return { ok: false, error: `"${label}" takes a number.` };
    if (input.numericValue == null) return { ok: true, value: { numericValue: null, textValue: null } };
    const error = numberError(label, input.numericValue, field);
    return error ? { ok: false, error } : { ok: true, value: { numericValue: input.numericValue, textValue: null } };
  }
  if (input.numericValue != null) return { ok: false, error: `"${label}" takes text.` };
  const text = blank(input.textValue) ? null : input.textValue!.trim();
  if (text && text.length > 500) return { ok: false, error: `"${label}" must be at most 500 characters.` };
  if (text && field.valueType === 'SELECT' && !field.options.includes(text)) return { ok: false, error: `"${label}": "${text}" is not one of the options.` };
  return { ok: true, value: { numericValue: null, textValue: text } };
}

/** True when nothing but possibly a comment is set: the answer is cleared. */
export function isEmptyResponse(v: ResponseValues): boolean {
  return v.answer == null && v.numericValue == null && v.textValue == null && v.selectedOptions == null && v.dateValue == null && v.datetimeValue == null && v.comment == null;
}

export function responseHasValue(item: EngineItem, r: ResponseValues | undefined): boolean {
  if (!r) return false;
  if (r.answer === 'NA') return item.allowNotApplicable;
  switch (item.responseType) {
    case 'YES_NO_NA':
      return r.answer != null;
    case 'NUMBER':
      return r.numericValue != null;
    case 'TEXT':
    case 'SELECT':
      return !blank(r.textValue);
    case 'MULTI_SELECT':
      return (r.selectedOptions?.length ?? 0) > 0;
    case 'DATE':
      return r.dateValue != null;
    case 'DATETIME':
      return r.datetimeValue != null;
    case 'PHOTO':
      return false;
  }
}

export function readingHasValue(field: EngineField, r: ReadingValues | undefined): boolean {
  if (!r) return false;
  return field.valueType === 'NUMBER' ? r.numericValue != null : !blank(r.textValue);
}

/** The failure rule: the item's failure answer was given. */
export function isFailure(item: EngineItem, answer: AnswerCode | null | undefined): boolean {
  return item.failureOnAnswer != null && answer === item.failureOnAnswer;
}

export function commentRequired(item: EngineItem, r: ResponseValues | undefined): boolean {
  const answer = r?.answer ?? null;
  return (isFailure(item, answer) && item.requiresCommentOnFailure) || (answer != null && item.commentOnAnswers.includes(answer));
}

export function photoRequired(item: EngineItem, r: ResponseValues | undefined): boolean {
  const answer = r?.answer ?? null;
  if (item.responseType === 'PHOTO') return item.isRequired && answer !== 'NA';
  return (isFailure(item, answer) && item.requiresPhotoOnFailure) || (answer != null && item.photoOnAnswers.includes(answer));
}

export interface VisitState {
  sections: readonly EngineSection[];
  items: readonly EngineItem[];
  fields: readonly EngineField[];
  rules: readonly EngineRule[];
  /** By checklist item id. */
  responses: ReadonlyMap<string, ResponseValues>;
  /** By reading field id. */
  readings: ReadonlyMap<string, ReadingValues>;
  /** Photos attached per checklist item id. */
  photoCounts: ReadonlyMap<string, number>;
  notApplicableSections: readonly string[];
  /**
   * Required values outside the template, e.g. each battery's voltage at a
   * site with a configured battery count. Counted like required readings of
   * their section (ignored when the section is not applicable).
   */
  extraRequired?: readonly { sectionCode: string; refId: string; label: string; done: boolean }[];
}

export type IssueKind = 'REQUIRED' | 'COMMENT_REQUIRED' | 'PHOTO_REQUIRED' | 'INCONSISTENT' | 'SIGNATURE_REQUIRED';

export interface VisitIssue {
  sectionCode: string;
  kind: IssueKind;
  refType: 'item' | 'reading' | 'rule' | 'battery_unit' | 'visit';
  refId: string;
  label: string;
}

function applicable(state: VisitState) {
  const na = new Set(state.notApplicableSections);
  const sections = state.sections.filter((s) => s.isActive && !na.has(s.code));
  const code = new Map(sections.map((s) => [s.id, s.code]));
  return {
    code,
    items: state.items.filter((i) => i.isActive && code.has(i.sectionId)),
    fields: state.fields.filter((f) => f.isActive && code.has(f.sectionId)),
  };
}

/** Everything that blocks completing the visit. */
export function visitIssues(state: VisitState): VisitIssue[] {
  const { code, items, fields } = applicable(state);
  const issues: VisitIssue[] = [];
  for (const item of items) {
    const r = state.responses.get(item.id);
    const base = { sectionCode: code.get(item.sectionId)!, refType: 'item' as const, refId: item.id, label: item.prompt };
    if (item.isRequired && item.responseType !== 'PHOTO' && !responseHasValue(item, r)) issues.push({ ...base, kind: 'REQUIRED' });
    if (commentRequired(item, r) && blank(r?.comment)) issues.push({ ...base, kind: 'COMMENT_REQUIRED' });
    if (photoRequired(item, r) && (state.photoCounts.get(item.id) ?? 0) === 0) issues.push({ ...base, kind: 'PHOTO_REQUIRED' });
  }
  for (const f of fields) {
    if (f.isRequired && !readingHasValue(f, state.readings.get(f.id))) {
      issues.push({ sectionCode: code.get(f.sectionId)!, kind: 'REQUIRED', refType: 'reading', refId: f.id, label: f.label });
    }
  }
  const applicableCodes = new Set(code.values());
  for (const x of state.extraRequired ?? []) {
    if (applicableCodes.has(x.sectionCode) && !x.done) issues.push({ sectionCode: x.sectionCode, kind: 'REQUIRED', refType: 'battery_unit', refId: x.refId, label: x.label });
  }
  return [...issues, ...consistencyIssues(state)];
}

const COMPARE: Record<string, (a: number, b: number) => boolean> = {
  '<=': (a, b) => a <= b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '>': (a, b) => a > b,
  '=': (a, b) => a === b,
};

/** Numeric values by analytics key, in applicable sections. */
export function keyedNumbers(state: VisitState): Map<string, { value: number; sectionCode: string }[]> {
  const { code, items, fields } = applicable(state);
  const out = new Map<string, { value: number; sectionCode: string }[]>();
  const add = (key: string | null, value: number | null | undefined, sectionCode: string) => {
    if (!key || value == null) return;
    out.set(key, [...(out.get(key) ?? []), { value, sectionCode }]);
  };
  for (const f of fields) add(f.analyticsKey, state.readings.get(f.id)?.numericValue, code.get(f.sectionId)!);
  for (const i of items) add(i.analyticsKey, state.responses.get(i.id)?.numericValue, code.get(i.sectionId)!);
  return out;
}

export function consistencyIssues(state: VisitState): VisitIssue[] {
  const values = keyedNumbers(state);
  const issues: VisitIssue[] = [];
  for (const rule of state.rules) {
    if (!rule.isActive) continue;
    for (const l of values.get(rule.lhsKey) ?? []) {
      for (const r of values.get(rule.rhsKey) ?? []) {
        if (!COMPARE[rule.operator]?.(l.value, r.value)) {
          issues.push({ sectionCode: l.sectionCode, kind: 'INCONSISTENT', refType: 'rule', refId: rule.id, label: rule.message });
        }
      }
    }
  }
  return issues;
}

export interface SectionProgress {
  code: string;
  name: string;
  required: number;
  done: number;
  failures: number;
  notApplicable: boolean;
}

export interface VisitProgress {
  /** Required answers and readings given, 0–100, two decimals. 100 when nothing is required. */
  completionPct: number;
  failureCount: number;
  sections: SectionProgress[];
}

export function visitProgress(state: VisitState): VisitProgress {
  const na = new Set(state.notApplicableSections);
  const { items, fields } = applicable(state);
  const bySection = new Map<string, SectionProgress>();
  for (const s of [...state.sections].filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder)) {
    bySection.set(s.id, { code: s.code, name: s.name, required: 0, done: 0, failures: 0, notApplicable: na.has(s.code) });
  }
  for (const item of items) {
    const p = bySection.get(item.sectionId)!;
    const r = state.responses.get(item.id);
    if (item.isRequired && item.responseType !== 'PHOTO') {
      p.required += 1;
      if (responseHasValue(item, r)) p.done += 1;
    }
    if (isFailure(item, r?.answer)) p.failures += 1;
  }
  for (const f of fields) {
    if (!f.isRequired) continue;
    const p = bySection.get(f.sectionId)!;
    p.required += 1;
    if (readingHasValue(f, state.readings.get(f.id))) p.done += 1;
  }
  for (const x of state.extraRequired ?? []) {
    const p = [...bySection.values()].find((s) => s.code === x.sectionCode);
    if (!p || p.notApplicable) continue;
    p.required += 1;
    if (x.done) p.done += 1;
  }
  const sections = [...bySection.values()];
  const required = sections.reduce((n, s) => n + s.required, 0);
  const done = sections.reduce((n, s) => n + s.done, 0);
  return {
    completionPct: required === 0 ? 100 : Math.floor((10000 * done) / required) / 100,
    failureCount: sections.reduce((n, s) => n + s.failures, 0),
    sections,
  };
}

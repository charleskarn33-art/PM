/**
 * Client-side mirror of the server PM rules (supabase/migrations/…_pm_engine.sql):
 * value presence, failure rules, completion %, failure count and submission
 * issues. The database remains authoritative; this gives technicians instant
 * feedback (and works offline). Parity is tested against the database.
 */
import type { Enums, Tables } from '../database.types';

export type Section = Pick<Tables<'pm_sections'>, 'id' | 'code' | 'name' | 'is_active' | 'allow_not_applicable' | 'sort_order'>;
export type ChecklistItem = Pick<
  Tables<'pm_checklist_items'>,
  | 'id'
  | 'section_id'
  | 'prompt'
  | 'response_type'
  | 'is_required'
  | 'is_active'
  | 'allow_not_applicable'
  | 'creates_failure_on_no'
  | 'creates_failure_on_yes'
  | 'requires_comment_on_failure'
  | 'requires_photo_on_failure'
  | 'requires_comment_on_answer'
  | 'requires_photo_on_answer'
>;
export type ReadingField = Pick<Tables<'pm_reading_fields'>, 'id' | 'section_id' | 'label' | 'value_type' | 'is_required' | 'is_active'>;
export type ResponseValue = Pick<
  Tables<'pm_responses'>,
  'checklist_item_id' | 'answer' | 'numeric_value' | 'text_value' | 'selected_options' | 'date_value' | 'datetime_value' | 'comment'
>;
export type ReadingValue = Pick<Tables<'pm_readings'>, 'reading_field_id' | 'numeric_value' | 'text_value'>;

export type IssueKind = 'REQUIRED' | 'COMMENT_REQUIRED' | 'PHOTO_REQUIRED';

export interface VisitIssue {
  sectionCode: string;
  refType: 'item' | 'reading';
  refId: string;
  label: string;
  issue: IssueKind;
}

export interface ChecklistState {
  sections: readonly Section[];
  items: readonly ChecklistItem[];
  readingFields: readonly ReadingField[];
  responses: readonly ResponseValue[];
  readings: readonly ReadingValue[];
  /** Number of photos attached per checklist item id. */
  photoCounts?: Readonly<Record<string, number>>;
  notApplicableSections: readonly string[];
  enforcePhotoRequirements?: boolean;
}

const blank = (s: string | null | undefined) => s == null || s.trim() === '';

export function responseHasValue(item: ChecklistItem, r: ResponseValue | undefined): boolean {
  if (!r) return false;
  if (r.answer === 'N/A' && item.allow_not_applicable) return true;
  switch (item.response_type) {
    case 'YES_NO_NA':
      return r.answer != null;
    case 'NUMBER':
      return r.numeric_value != null;
    case 'TEXT':
    case 'SELECT':
      return !blank(r.text_value);
    case 'MULTI_SELECT':
      return (r.selected_options?.length ?? 0) > 0;
    case 'DATE':
      return r.date_value != null;
    case 'DATETIME':
      return r.datetime_value != null;
    case 'PHOTO':
      return true;
    default:
      return false;
  }
}

export function readingHasValue(field: ReadingField, r: ReadingValue | undefined): boolean {
  if (!r) return false;
  return field.value_type === 'NUMBER' ? r.numeric_value != null : !blank(r.text_value);
}

/** Mirrors pm_responses.is_failure (computed by the server trigger). */
export function isFailure(item: ChecklistItem, answer: Enums<'yes_no_na'> | null | undefined): boolean {
  return (answer === 'NO' && item.creates_failure_on_no) || (answer === 'YES' && item.creates_failure_on_yes);
}

export function commentRequired(item: ChecklistItem, r: ResponseValue | undefined): boolean {
  const answer = r?.answer ?? null;
  return (isFailure(item, answer) && item.requires_comment_on_failure) || (answer != null && item.requires_comment_on_answer.includes(answer));
}

export function photoRequired(item: ChecklistItem, r: ResponseValue | undefined): boolean {
  const answer = r?.answer ?? null;
  return (
    (item.response_type === 'PHOTO' && item.is_required) ||
    (isFailure(item, answer) && item.requires_photo_on_failure) ||
    (answer != null && item.requires_photo_on_answer.includes(answer))
  );
}

function applicable(state: ChecklistState) {
  const na = new Set(state.notApplicableSections);
  const sections = state.sections.filter((s) => s.is_active && !na.has(s.code));
  const sectionCode = new Map(sections.map((s) => [s.id, s.code]));
  const items = state.items.filter((i) => i.is_active && sectionCode.has(i.section_id));
  const fields = state.readingFields.filter((f) => f.is_active && sectionCode.has(f.section_id));
  const responses = new Map(state.responses.map((r) => [r.checklist_item_id, r]));
  const readings = new Map(state.readings.map((r) => [r.reading_field_id, r]));
  return { sections, sectionCode, items, fields, responses, readings };
}

/** Everything that blocks submission; same list as pm_visit_issues(). */
export function visitIssues(state: ChecklistState): VisitIssue[] {
  const { sectionCode, items, fields, responses, readings } = applicable(state);
  const enforcePhotos = state.enforcePhotoRequirements ?? true;
  const issues: VisitIssue[] = [];
  for (const item of items) {
    const r = responses.get(item.id);
    const base = { sectionCode: sectionCode.get(item.section_id)!, refType: 'item' as const, refId: item.id, label: item.prompt };
    if (item.is_required && item.response_type !== 'PHOTO' && !responseHasValue(item, r)) issues.push({ ...base, issue: 'REQUIRED' });
    if (commentRequired(item, r) && blank(r?.comment)) issues.push({ ...base, issue: 'COMMENT_REQUIRED' });
    if (enforcePhotos && photoRequired(item, r) && (state.photoCounts?.[item.id] ?? 0) === 0) {
      issues.push({ ...base, issue: 'PHOTO_REQUIRED' });
    }
  }
  for (const field of fields) {
    if (field.is_required && !readingHasValue(field, readings.get(field.id))) {
      issues.push({ sectionCode: sectionCode.get(field.section_id)!, refType: 'reading', refId: field.id, label: field.label, issue: 'REQUIRED' });
    }
  }
  return issues;
}

export interface SectionProgress {
  code: string;
  required: number;
  done: number;
  failures: number;
  notApplicable: boolean;
}

export interface VisitProgress {
  /** Rounded to 2 decimals, like pm_visits.completion_pct. */
  completionPct: number;
  failureCount: number;
  sections: SectionProgress[];
}

/** Mirrors private.visit_progress(). */
export function visitProgress(state: ChecklistState): VisitProgress {
  const na = new Set(state.notApplicableSections);
  const { items, fields, responses, readings } = applicable(state);
  const bySection = new Map<string, SectionProgress>();
  for (const s of [...state.sections].filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order)) {
    bySection.set(s.id, { code: s.code, required: 0, done: 0, failures: 0, notApplicable: na.has(s.code) });
  }
  for (const item of items) {
    const p = bySection.get(item.section_id)!;
    const r = responses.get(item.id);
    if (item.is_required && item.response_type !== 'PHOTO') {
      p.required += 1;
      if (responseHasValue(item, r)) p.done += 1;
    }
    if (isFailure(item, r?.answer)) p.failures += 1;
  }
  for (const field of fields) {
    if (!field.is_required) continue;
    const p = bySection.get(field.section_id)!;
    p.required += 1;
    if (readingHasValue(field, readings.get(field.id))) p.done += 1;
  }
  const sections = [...bySection.values()];
  const required = sections.reduce((n, s) => n + s.required, 0);
  const done = sections.reduce((n, s) => n + s.done, 0);
  return {
    completionPct: required === 0 ? 100 : Math.round((10000 * done) / required) / 100,
    failureCount: sections.reduce((n, s) => n + s.failures, 0),
    sections,
  };
}

/** Client-side check before saving a number; mirrors private.check_number(). */
export function numberError(
  label: string,
  value: number,
  rule: { min?: number | null; max?: number | null; integer?: boolean },
): string | null {
  if (!Number.isFinite(value)) return `"${label}" must be a number`;
  if (rule.min != null && value < rule.min) return `"${label}" must be at least ${rule.min}`;
  if (rule.max != null && value > rule.max) return `"${label}" must be at most ${rule.max}`;
  if (rule.integer && !Number.isInteger(value)) return `"${label}" must be a whole number`;
  return null;
}

export const ISSUE_LABELS: Record<IssueKind, string> = {
  REQUIRED: 'Answer required',
  COMMENT_REQUIRED: 'Comment required',
  PHOTO_REQUIRED: 'Photo required',
};

/** "Unable to submit because 3 required fields are incomplete." */
export function submissionMessage(issueCount: number): string {
  return issueCount === 0
    ? 'Ready to submit.'
    : `Unable to submit because ${issueCount} required field${issueCount === 1 ? ' is' : 's are'} incomplete.`;
}

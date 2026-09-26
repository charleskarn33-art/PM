/**
 * Pure helpers for the PM screens (unit-tested). The server decides what is
 * valid and complete; these only shape what the phone shows and sends.
 */
import type { Answer, ChecklistItem, ReadingField, ResponsePatch, ResponseRow, VisitIssue } from '@/lib/api/types';

export const EMPTY_RESPONSE = (checklistItemId: string): ResponseRow => ({
  checklistItemId,
  answer: null,
  numericValue: null,
  textValue: null,
  selectedOptions: null,
  dateValue: null,
  datetimeValue: null,
  comment: null,
  isFailure: false,
});

/** What the technician typed into a number field; a comma is accepted as the decimal sign. Empty → null. */
export function parseNumberInput(text: string): { value: number | null; error?: string } {
  const t = text.trim().replace(',', '.');
  if (t === '') return { value: null };
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { value: null, error: 'Enter a number' };
  return { value: Number(t) };
}

/** The configured limits of a number (none are assumed). */
export function numberProblem(value: number, rule: { minValue: number | null; maxValue: number | null; isInteger: boolean }): string | null {
  if (rule.minValue != null && value < rule.minValue) return `Must be at least ${rule.minValue}`;
  if (rule.maxValue != null && value > rule.maxValue) return `Must be at most ${rule.maxValue}`;
  if (rule.isInteger && !Number.isInteger(value)) return 'Must be a whole number';
  return null;
}

export function limitsHint(rule: { minValue: number | null; maxValue: number | null; unit: string | null }): string | null {
  const u = rule.unit ? ` ${rule.unit}` : '';
  if (rule.minValue != null && rule.maxValue != null) return `${rule.minValue} – ${rule.maxValue}${u}`;
  if (rule.minValue != null) return `≥ ${rule.minValue}${u}`;
  if (rule.maxValue != null) return `≤ ${rule.maxValue}${u}`;
  return null;
}

export const answerLabel = (a: Answer) => (a === 'NA' ? 'N/A' : a === 'YES' ? 'Yes' : 'No');

export function isFailureAnswer(item: ChecklistItem, answer: Answer | null | undefined): boolean {
  return item.failureOnAnswer != null && answer === item.failureOnAnswer;
}

export function needsComment(item: ChecklistItem, r: ResponseRow | undefined): boolean {
  const a = r?.answer ?? null;
  return (isFailureAnswer(item, a) && item.requiresCommentOnFailure) || (a != null && item.commentOnAnswers.includes(a));
}

export function needsPhoto(item: ChecklistItem, r: ResponseRow | undefined): boolean {
  const a = r?.answer ?? null;
  if (item.responseType === 'PHOTO') return item.isRequired && a !== 'NA';
  return (isFailureAnswer(item, a) && item.requiresPhotoOnFailure) || (a != null && item.photoOnAnswers.includes(a));
}

/** Applies an edit to the shown answer straight away (the server's copy replaces it after saving). */
export function applyPatch(current: ResponseRow | undefined, itemId: string, patch: ResponsePatch, item: ChecklistItem): ResponseRow {
  const next = { ...(current ?? EMPTY_RESPONSE(itemId)), ...patch };
  return { ...next, isFailure: isFailureAnswer(item, next.answer) };
}

/** The request body for one answer: the full current value, so the server stores exactly what is shown. */
export function responseBody(r: ResponseRow, clientUpdatedAt: string) {
  return {
    checklistItemId: r.checklistItemId,
    answer: r.answer,
    numericValue: r.numericValue,
    textValue: r.textValue,
    selectedOptions: r.selectedOptions,
    dateValue: r.dateValue,
    datetimeValue: r.datetimeValue,
    comment: r.comment,
    clientUpdatedAt,
  };
}

export function readingBody(field: ReadingField, value: number | string | null, clientUpdatedAt: string) {
  return field.valueType === 'NUMBER'
    ? { readingFieldId: field.id, numericValue: typeof value === 'number' ? value : null, clientUpdatedAt }
    : { readingFieldId: field.id, textValue: typeof value === 'string' && value.trim() ? value.trim() : null, clientUpdatedAt };
}

export const ISSUE_TEXT: Record<VisitIssue['kind'], string> = {
  REQUIRED: 'Answer required',
  COMMENT_REQUIRED: 'Comment required',
  PHOTO_REQUIRED: 'Photo required',
  INCONSISTENT: 'Values do not match',
  SIGNATURE_REQUIRED: 'Signature required',
};

/** Issues grouped by section code, in the order given (visit-level ones under ''). */
export function issuesBySection(issues: readonly VisitIssue[]): Map<string, VisitIssue[]> {
  const out = new Map<string, VisitIssue[]>();
  for (const i of issues) out.set(i.sectionCode, [...(out.get(i.sectionCode) ?? []), i]);
  return out;
}

/** "Unable to complete: 3 items need attention." */
export function completionMessage(count: number): string {
  return count === 0 ? 'Ready to complete.' : `Unable to complete: ${count} item${count === 1 ? ' needs' : 's need'} attention.`;
}

export function formatDistance(m: number | null): string {
  if (m == null) return 'unknown distance';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Due-date wording for a schedule, relative to today (YYYY-MM-DD). */
export function dueText(dueDate: string, today: string): string {
  const days = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 1) return `Due in ${days} days`;
  return days === -1 ? 'Overdue by 1 day' : `Overdue by ${-days} days`;
}

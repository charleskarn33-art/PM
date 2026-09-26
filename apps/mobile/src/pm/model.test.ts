import { describe, expect, it } from 'vitest';
import type { ChecklistItem } from '@/lib/api/types';
import { applyPatch, completionMessage, dueText, formatDistance, issuesBySection, limitsHint, needsComment, needsPhoto, numberProblem, parseNumberInput, readingBody, responseBody } from './model';

const item = (over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id: 'i1',
  sectionId: 's1',
  code: 'x',
  prompt: 'Is Automation Working?',
  helpText: null,
  analyticsKey: null,
  isActive: true,
  responseType: 'YES_NO_NA',
  options: [],
  allowNotApplicable: true,
  isRequired: true,
  unit: null,
  minValue: null,
  maxValue: null,
  isInteger: false,
  failureOnAnswer: 'NO',
  requiresPhotoOnFailure: true,
  requiresCommentOnFailure: true,
  photoOnAnswers: [],
  commentOnAnswers: [],
  photoInstructions: null,
  ...over,
});

describe('PM model', () => {
  it('parses numbers typed on a phone keypad; limits only when configured', () => {
    expect(parseNumberInput('12,7')).toEqual({ value: 12.7 });
    expect(parseNumberInput(' ')).toEqual({ value: null });
    expect(parseNumberInput('12a').error).toBe('Enter a number');
    expect(numberProblem(120, { minValue: 0, maxValue: 100, isInteger: false })).toBe('Must be at most 100');
    expect(numberProblem(2.5, { minValue: null, maxValue: null, isInteger: true })).toBe('Must be a whole number');
    expect(numberProblem(99999, { minValue: null, maxValue: null, isInteger: false })).toBeNull();
    expect(limitsHint({ minValue: 0, maxValue: 100, unit: '%' })).toBe('0 – 100 %');
    expect(limitsHint({ minValue: null, maxValue: null, unit: 'V' })).toBeNull();
  });

  it('failure answers need the configured evidence', () => {
    const i = item();
    const no = applyPatch(undefined, 'i1', { answer: 'NO' }, i);
    expect(no.isFailure).toBe(true);
    expect([needsComment(i, no), needsPhoto(i, no)]).toEqual([true, true]);
    const yes = applyPatch(no, 'i1', { answer: 'YES' }, i);
    expect([yes.isFailure, needsComment(i, yes), needsPhoto(i, yes)]).toEqual([false, false, false]);
    const ext = item({ failureOnAnswer: 'NO', requiresPhotoOnFailure: false, photoOnAnswers: ['YES'] });
    expect(needsPhoto(ext, applyPatch(undefined, 'i1', { answer: 'YES' }, ext))).toBe(true);
    expect(needsPhoto(item({ responseType: 'PHOTO', failureOnAnswer: null }), undefined)).toBe(true);
  });

  it('sends the whole answer with the time it was made', () => {
    const r = applyPatch(undefined, 'i1', { answer: 'YES', comment: 'ok' }, item());
    expect(responseBody(r, '2026-09-15T10:00:00.000Z')).toEqual({
      checklistItemId: 'i1',
      answer: 'YES',
      numericValue: null,
      textValue: null,
      selectedOptions: null,
      dateValue: null,
      datetimeValue: null,
      comment: 'ok',
      clientUpdatedAt: '2026-09-15T10:00:00.000Z',
    });
    const field = { id: 'f', sectionId: 's', code: 'c', label: 'Oil', valueType: 'TEXT' as const, unit: null, isInteger: false, minValue: null, maxValue: null, options: [], isRequired: true, helpText: null, analyticsKey: null, isActive: true };
    expect(readingBody(field, ' Okay ', 't')).toEqual({ readingFieldId: 'f', textValue: 'Okay', clientUpdatedAt: 't' });
    expect(readingBody({ ...field, valueType: 'NUMBER' }, 12.7, 't')).toEqual({ readingFieldId: 'f', numericValue: 12.7, clientUpdatedAt: 't' });
  });

  it('wording', () => {
    expect(completionMessage(0)).toBe('Ready to complete.');
    expect(completionMessage(1)).toBe('Unable to complete: 1 item needs attention.');
    expect(formatDistance(55.4)).toBe('55 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(dueText('2026-09-15', '2026-09-15')).toBe('Due today');
    expect(dueText('2026-09-20', '2026-09-15')).toBe('Due in 5 days');
    expect(dueText('2026-09-13', '2026-09-15')).toBe('Overdue by 2 days');
    const groups = issuesBySection([
      { sectionCode: 'A', kind: 'REQUIRED', refType: 'item', refId: '1', label: 'x' },
      { sectionCode: '', kind: 'SIGNATURE_REQUIRED', refType: 'visit', refId: 'v', label: 'Technician signature' },
      { sectionCode: 'A', kind: 'PHOTO_REQUIRED', refType: 'item', refId: '2', label: 'y' },
    ]);
    expect([...groups.keys()]).toEqual(['A', '']);
    expect(groups.get('A')).toHaveLength(2);
  });
});

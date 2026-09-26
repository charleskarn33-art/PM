import type { PmChecklistItem, PmConsistencyRule, PmReadingField, PmSection, Prisma } from '../generated/prisma/client.js';
import type { AnswerCode, EngineField, EngineItem, EngineRule, EngineSection } from './engine.js';

/** Decimal columns → numbers for the API and the engine (values stay exact to 6 decimals). */
export const num = (d: Prisma.Decimal | null | undefined): number | null => (d == null ? null : Number(d));

const strings = (j: Prisma.JsonValue | null | undefined): string[] => (Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : []);
const answers = (j: Prisma.JsonValue | null | undefined): AnswerCode[] => strings(j).filter((a): a is AnswerCode => a === 'YES' || a === 'NO' || a === 'NA');

export const toEngineSection = (s: PmSection): EngineSection => ({
  id: s.id,
  code: s.code,
  name: s.name,
  sortOrder: s.sortOrder,
  isActive: s.isActive,
  allowNotApplicable: s.allowNotApplicable,
});

export const toEngineItem = (i: PmChecklistItem): EngineItem => ({
  id: i.id,
  sectionId: i.sectionId,
  prompt: i.prompt,
  responseType: i.responseType,
  options: strings(i.options),
  allowNotApplicable: i.allowNotApplicable,
  isRequired: i.isRequired,
  minValue: num(i.minValue),
  maxValue: num(i.maxValue),
  isInteger: i.isInteger,
  failureOnAnswer: i.failureOnAnswer,
  requiresPhotoOnFailure: i.requiresPhotoOnFailure,
  requiresCommentOnFailure: i.requiresCommentOnFailure,
  photoOnAnswers: answers(i.photoOnAnswers),
  commentOnAnswers: answers(i.commentOnAnswers),
  analyticsKey: i.analyticsKey,
  isActive: i.isActive,
});

export const toEngineField = (f: PmReadingField): EngineField => ({
  id: f.id,
  sectionId: f.sectionId,
  label: f.label,
  valueType: f.valueType,
  options: strings(f.options),
  isRequired: f.isRequired,
  minValue: num(f.minValue),
  maxValue: num(f.maxValue),
  isInteger: f.isInteger,
  analyticsKey: f.analyticsKey,
  isActive: f.isActive,
});

export const toEngineRule = (r: PmConsistencyRule): EngineRule => ({
  id: r.id,
  lhsKey: r.lhsKey,
  operator: r.operator,
  rhsKey: r.rhsKey,
  message: r.message,
  isActive: r.isActive,
});

/** API view of a checklist item (JSON columns as arrays, limits as numbers). */
export const itemView = (i: PmChecklistItem) => ({
  ...i,
  options: strings(i.options),
  photoOnAnswers: answers(i.photoOnAnswers),
  commentOnAnswers: answers(i.commentOnAnswers),
  minValue: num(i.minValue),
  maxValue: num(i.maxValue),
});

export const fieldView = (f: PmReadingField) => ({ ...f, options: strings(f.options), minValue: num(f.minValue), maxValue: num(f.maxValue) });

export const stringList = strings;

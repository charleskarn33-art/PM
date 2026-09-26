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

/** Decimal columns of a record → numbers (for the API). */
function numbers<T extends Record<string, unknown>>(row: T | null) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v != null && typeof v === 'object' && 'toFixed' in v && !(v instanceof Date) ? Number(v) : v]));
}

/** The power-module records of a visit, as returned by the API. */
export function moduleView(m: {
  generator: Record<string, unknown> | null;
  dc: Record<string, unknown> | null;
  dcPhases: Record<string, unknown>[];
  battery: Record<string, unknown> | null;
  batteryUnits: Record<string, unknown>[];
  solar: Record<string, unknown> | null;
  nonTechnical: Record<string, unknown> | null;
  earthing: Record<string, unknown> | null;
}) {
  return {
    generator: numbers(m.generator),
    dc: m.dc ? { ...numbers(m.dc), phases: m.dcPhases.map((p) => numbers(p)) } : null,
    battery: m.battery ? { ...numbers(m.battery), units: m.batteryUnits.map((u) => numbers(u)) } : null,
    solar: numbers(m.solar),
    nonTechnical: numbers(m.nonTechnical),
    earthing: numbers(m.earthing),
  };
}

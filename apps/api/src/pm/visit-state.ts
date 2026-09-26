import type { PmVisit, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { toIso } from './dates.js';
import { visitProgress, type VisitState } from './engine.js';
import { num, stringList, toEngineField, toEngineItem, toEngineRule, toEngineSection } from './mapping.js';

type Db = Prisma.TransactionClient | PrismaClient;

/** A template version's sections, questions and readings, in display order. */
export async function loadStructure(db: Db, templateId: string) {
  const sections = await db.pmSection.findMany({ where: { templateId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  const ids = sections.map((s) => s.id);
  const [items, fields] = await Promise.all([
    db.pmChecklistItem.findMany({ where: { sectionId: { in: ids } }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
    db.pmReadingField.findMany({ where: { sectionId: { in: ids } }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
  ]);
  return { sections, items, fields };
}

/** Everything the engine needs to judge a visit. */
export async function loadVisitState(db: Db, visit: Pick<PmVisit, 'id' | 'templateId' | 'notApplicableSections'>): Promise<VisitState> {
  const [structure, responses, readings, photoCounts, rules] = await Promise.all([
    loadStructure(db, visit.templateId),
    db.pmResponse.findMany({ where: { visitId: visit.id } }),
    db.pmReading.findMany({ where: { visitId: visit.id } }),
    db.pmPhoto.groupBy({ by: ['checklistItemId'], where: { visitId: visit.id, checklistItemId: { not: null } }, _count: { _all: true } }),
    db.pmConsistencyRule.findMany({ where: { isActive: true } }),
  ]);
  return {
    sections: structure.sections.map(toEngineSection),
    items: structure.items.map(toEngineItem),
    fields: structure.fields.map(toEngineField),
    rules: rules.map(toEngineRule),
    responses: new Map(
      responses.map((r) => [
        r.checklistItemId,
        {
          answer: r.answer,
          numericValue: num(r.numericValue),
          textValue: r.textValue,
          selectedOptions: r.selectedOptions == null ? null : stringList(r.selectedOptions),
          dateValue: r.dateValue ? toIso(r.dateValue) : null,
          datetimeValue: r.datetimeValue ? r.datetimeValue.toISOString() : null,
          comment: r.comment,
        },
      ]),
    ),
    readings: new Map(readings.map((r) => [r.readingFieldId, { numericValue: num(r.numericValue), textValue: r.textValue }])),
    photoCounts: new Map(photoCounts.map((p) => [p.checklistItemId!, p._count._all])),
    notApplicableSections: stringList(visit.notApplicableSections),
  };
}

/** Stores completion % and failure count computed from the visit's data. */
export async function refreshProgress(db: Db, visit: Pick<PmVisit, 'id' | 'templateId' | 'notApplicableSections'>) {
  const progress = visitProgress(await loadVisitState(db, visit));
  await db.pmVisit.update({ where: { id: visit.id }, data: { completionPct: progress.completionPct, failureCount: progress.failureCount } });
  return progress;
}

import type { PmVisit, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { toIso } from './dates.js';
import { visitProgress, type VisitState } from './engine.js';
import { num, stringList, toEngineField, toEngineItem, toEngineRule, toEngineSection } from './mapping.js';
import { buildModules, type KeyedValue } from './modules.js';

type Db = Prisma.TransactionClient | PrismaClient;
type VisitRef = Pick<PmVisit, 'id' | 'siteId' | 'templateId' | 'notApplicableSections' | 'startedAt'>;

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

/**
 * Battery units a visit must record: one per battery at sites with a
 * configured battery count, in the template's (first) battery section.
 */
export async function batteryUnitRequirement(db: Db, visit: Pick<PmVisit, 'id' | 'siteId' | 'templateId'>) {
  const [site, section] = await Promise.all([
    db.site.findUnique({ where: { id: visit.siteId }, select: { batteryUnitCount: true } }),
    db.pmSection.findFirst({ where: { templateId: visit.templateId, category: 'BATTERY', isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  if (!site?.batteryUnitCount || !section) return null;
  return { count: site.batteryUnitCount, sectionCode: section.code };
}

/** Everything the engine needs to judge a visit. */
export async function loadVisitState(db: Db, visit: Omit<VisitRef, 'startedAt'>): Promise<VisitState> {
  const [structure, responses, readings, photoCounts, rules, units, requirement] = await Promise.all([
    loadStructure(db, visit.templateId),
    db.pmResponse.findMany({ where: { visitId: visit.id } }),
    db.pmReading.findMany({ where: { visitId: visit.id } }),
    db.pmPhoto.groupBy({ by: ['checklistItemId'], where: { visitId: visit.id, checklistItemId: { not: null } }, _count: { _all: true } }),
    db.pmConsistencyRule.findMany({ where: { isActive: true } }),
    db.batteryUnitReading.findMany({ where: { visitId: visit.id }, select: { unitNumber: true } }),
    batteryUnitRequirement(db, visit),
  ]);
  const recorded = new Set(units.map((u) => u.unitNumber));
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
    extraRequired: requirement
      ? Array.from({ length: requirement.count }, (_, i) => ({
          sectionCode: requirement.sectionCode,
          refId: String(i + 1),
          label: `Battery ${i + 1} voltage`,
          done: recorded.has(i + 1),
        }))
      : [],
  };
}

/**
 * Rebuilds the visit's power-module records from its answers and readings
 * (applicable sections only; a section marked N/A has no record).
 */
export async function refreshModules(db: Db, visit: VisitRef) {
  const na = new Set(stringList(visit.notApplicableSections));
  const sections = (await db.pmSection.findMany({ where: { templateId: visit.templateId, isActive: true } })).filter((s) => !na.has(s.code));
  const sectionIds = sections.map((s) => s.id);
  const category = new Map(sections.map((s) => [s.id, s.category]));
  const [responses, readings, units] = await Promise.all([
    db.pmResponse.findMany({ where: { visitId: visit.id, item: { sectionId: { in: sectionIds }, isActive: true, analyticsKey: { not: null } } }, include: { item: true } }),
    db.pmReading.findMany({ where: { visitId: visit.id, field: { sectionId: { in: sectionIds }, isActive: true, analyticsKey: { not: null } } }, include: { field: true } }),
    db.batteryUnitReading.findMany({ where: { visitId: visit.id }, orderBy: { unitNumber: 'asc' } }),
  ]);
  const values: KeyedValue[] = [
    ...readings.map((r) => ({ key: r.field.analyticsKey!, category: category.get(r.field.sectionId)!, num: r.numericValue, text: r.textValue, answer: null, comment: null })),
    ...responses.map((r) => ({ key: r.item.analyticsKey!, category: category.get(r.item.sectionId)!, num: r.numericValue, text: r.textValue, answer: r.answer, comment: r.comment })),
  ];
  const m = buildModules(values, new Set(sections.map((s) => s.category)), units);
  const base = { siteId: visit.siteId, recordedAt: visit.startedAt };
  const where = { visitId: visit.id };

  if (m.generator) await db.generatorReading.upsert({ where, create: { ...where, ...base, ...m.generator }, update: { ...base, ...m.generator } });
  else await db.generatorReading.deleteMany({ where });
  if (m.dc) await db.dcReading.upsert({ where, create: { ...where, ...base, ...m.dc }, update: { ...base, ...m.dc } });
  else await db.dcReading.deleteMany({ where });
  await db.dcPhaseCurrent.deleteMany({ where: { visitId: visit.id, phaseNumber: { notIn: m.dcPhases.map((p) => p.phaseNumber) } } });
  for (const p of m.dcPhases) {
    await db.dcPhaseCurrent.upsert({
      where: { visitId_phaseNumber: { visitId: visit.id, phaseNumber: p.phaseNumber } },
      create: { ...where, ...base, ...p },
      update: { ...base, ampValue: p.ampValue, comment: p.comment },
    });
  }
  if (m.battery) await db.batteryReading.upsert({ where, create: { ...where, ...base, ...m.battery }, update: { ...base, ...m.battery } });
  else await db.batteryReading.deleteMany({ where });
  if (m.solar) await db.solarReading.upsert({ where, create: { ...where, ...base, ...m.solar }, update: { ...base, ...m.solar } });
  else await db.solarReading.deleteMany({ where });
  if (m.nonTechnical) await db.nonTechnicalObservation.upsert({ where, create: { ...where, ...base, ...m.nonTechnical }, update: { ...base, ...m.nonTechnical } });
  else await db.nonTechnicalObservation.deleteMany({ where });
  if (m.earthing) await db.earthingReading.upsert({ where, create: { ...where, ...base, ...m.earthing }, update: { ...base, ...m.earthing } });
  else await db.earthingReading.deleteMany({ where });
  return m;
}

/** Stores completion % and failure count, and rebuilds the power-module records. */
export async function refreshProgress(db: Db, visit: VisitRef) {
  const progress = visitProgress(await loadVisitState(db, visit));
  await db.pmVisit.update({ where: { id: visit.id }, data: { completionPct: progress.completionPct, failureCount: progress.failureCount } });
  await refreshModules(db, visit);
  return progress;
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/http-exception.filter.js';
import { invalid, notFound, rethrowDbError } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import type { PmChecklistItem, PmReadingField, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { fieldView, itemView } from './mapping.js';
import {
  ConsistencyRuleInput,
  ConsistencyRulePatch,
  ItemInput,
  ReadingFieldInput,
  SectionInput,
  SectionPatch,
  TemplateInput,
  TemplatePatch,
} from './templates.schemas.js';

type Tx = Prisma.TransactionClient;

const notDraft = () => new AppError(HttpStatus.CONFLICT, 'TEMPLATE_NOT_DRAFT', 'Only a draft template version can be changed. Create a new version first.');

/**
 * PM templates and their versions. A version's structure (sections,
 * questions, readings, failure rules) is edited only while it is a DRAFT;
 * activating it retires the previous version and moves open schedules to
 * it. Visits keep the version they started on, so history never changes.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Templates and versions --------------------------------------------------

  async list() {
    const rows = await this.prisma.pmTemplate.findMany({
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      include: { _count: { select: { sections: true, visits: true, schedules: true } } },
    });
    return rows.map(({ _count, ...t }) => ({ ...t, sectionCount: _count.sections, visitCount: _count.visits, scheduleCount: _count.schedules }));
  }

  /** A version with its full structure, in display order. */
  async get(id: string) {
    const t = await this.prisma.pmTemplate.findUnique({
      where: { id },
      include: {
        sections: {
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          include: { items: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }, readingFields: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
        },
      },
    });
    if (!t) throw notFound('Template');
    return {
      ...t,
      sections: t.sections.map((s) => ({ ...s, items: s.items.map(itemView), readingFields: s.readingFields.map(fieldView) })),
    };
  }

  /** The active version of a template code (what new visits use). */
  async activeVersion(code: string) {
    const t = await this.prisma.pmTemplate.findFirst({ where: { code, status: 'ACTIVE' } });
    if (!t) throw invalid('NO_ACTIVE_TEMPLATE', `Template ${code} has no active version.`);
    return t;
  }

  async create(input: unknown, actorId: string) {
    const data = parseInput(TemplateInput, input);
    if (await this.prisma.pmTemplate.findFirst({ where: { code: data.code } })) {
      throw new AppError(HttpStatus.CONFLICT, 'ALREADY_EXISTS', 'A template with this code exists. Create a new version of it instead.', { field: 'code' });
    }
    return this.prisma.pmTemplate
      .create({ data: { ...data, version: 1, status: 'DRAFT', createdById: actorId, updatedById: actorId } })
      .catch(rethrowDbError);
  }

  async update(id: string, patch: unknown, actorId: string) {
    const data = parseInput(TemplatePatch, patch);
    await this.requireDraft(id);
    return this.prisma.pmTemplate.update({ where: { id }, data: { ...data, updatedById: actorId } });
  }

  /** Copies a version (its active sections, questions and readings) into a new DRAFT version. */
  async newVersion(id: string, actorId: string) {
    return this.prisma
      .$transaction(async (tx) => {
        const src = await tx.pmTemplate.findUnique({ where: { id } });
        if (!src) throw notFound('Template');
        await this.lockCode(tx, src.code);
        const versions = await tx.pmTemplate.findMany({ where: { code: src.code }, select: { version: true, status: true } });
        if (versions.some((v) => v.status === 'DRAFT')) {
          throw new AppError(HttpStatus.CONFLICT, 'DRAFT_EXISTS', 'This template already has a draft version. Edit or delete it first.');
        }
        const copy = await tx.pmTemplate.create({
          data: {
            code: src.code,
            name: src.name,
            description: src.description,
            version: Math.max(...versions.map((v) => v.version)) + 1,
            status: 'DRAFT',
            createdById: actorId,
            updatedById: actorId,
          },
        });
        const sections = await tx.pmSection.findMany({ where: { templateId: id, isActive: true }, include: { items: { where: { isActive: true } }, readingFields: { where: { isActive: true } } } });
        for (const { id: _sid, templateId: _t, createdAt: _c, updatedAt: _u, items, readingFields, ...s } of sections) {
          const section = await tx.pmSection.create({ data: { ...s, templateId: copy.id, createdById: actorId, updatedById: actorId } });
          if (items.length) {
            await tx.pmChecklistItem.createMany({
              data: items.map(({ id: _i, sectionId: _s, createdAt: _ca, updatedAt: _ua, ...i }) => ({
                ...i,
                options: i.options ?? [],
                photoOnAnswers: i.photoOnAnswers ?? [],
                commentOnAnswers: i.commentOnAnswers ?? [],
                sectionId: section.id,
                createdById: actorId,
                updatedById: actorId,
              })),
            });
          }
          if (readingFields.length) {
            await tx.pmReadingField.createMany({
              data: readingFields.map(({ id: _i, sectionId: _s, createdAt: _ca, updatedAt: _ua, ...f }) => ({
                ...f,
                options: f.options ?? [],
                sectionId: section.id,
                createdById: actorId,
                updatedById: actorId,
              })),
            });
          }
        }
        return copy;
      })
      .catch(rethrowDbError);
  }

  /**
   * Makes a DRAFT the active version: the previous active version is retired
   * and open schedules (scheduled / overdue) move to the new version.
   */
  async activate(id: string, actorId: string) {
    return this.prisma
      .$transaction(async (tx) => {
        const t = await tx.pmTemplate.findUnique({ where: { id } });
        if (!t) throw notFound('Template');
        await this.lockCode(tx, t.code);
        const fresh = await tx.pmTemplate.findUniqueOrThrow({ where: { id } });
        if (fresh.status !== 'DRAFT') throw invalid('TEMPLATE_NOT_DRAFT', 'Only a draft version can be activated.');
        const questions = await tx.pmChecklistItem.count({ where: { isActive: true, section: { templateId: id, isActive: true } } });
        if (questions === 0) throw invalid('TEMPLATE_EMPTY', 'A template needs at least one active question before it can be activated.');
        const now = new Date();
        const previous = await tx.pmTemplate.findMany({ where: { code: t.code, status: 'ACTIVE' }, select: { id: true } });
        await tx.pmTemplate.updateMany({ where: { code: t.code, status: 'ACTIVE' }, data: { status: 'RETIRED', retiredAt: now, updatedById: actorId } });
        const active = await tx.pmTemplate.update({ where: { id }, data: { status: 'ACTIVE', activatedAt: now, updatedById: actorId } });
        const moved = await tx.pmSchedule.updateMany({
          where: { templateId: { in: previous.map((p) => p.id) }, status: { in: ['SCHEDULED', 'OVERDUE'] } },
          data: { templateId: id, updatedById: actorId },
        });
        return { ...active, schedulesMoved: moved.count };
      })
      .catch(rethrowDbError);
  }

  /** Deletes a DRAFT version that was never used. */
  async deleteDraft(id: string) {
    await this.prisma
      .$transaction(async (tx) => {
        const t = await tx.pmTemplate.findUnique({ where: { id } });
        if (!t) throw notFound('Template');
        if (t.status !== 'DRAFT') throw notDraft();
        await tx.pmSection.deleteMany({ where: { templateId: id } }); // questions and readings cascade
        await tx.pmTemplate.delete({ where: { id } });
      })
      .catch(rethrowDbError);
  }

  // --- Sections ------------------------------------------------------------------

  async addSection(templateId: string, input: unknown, actorId: string) {
    const data = parseInput(SectionInput, input);
    await this.requireDraft(templateId);
    return this.prisma.pmSection.create({ data: { ...data, requiresEquipment: data.requiresEquipment ?? null, templateId, createdById: actorId, updatedById: actorId } }).catch(rethrowDbError);
  }

  async updateSection(id: string, patch: unknown, actorId: string) {
    const data = parseInput(SectionPatch, patch);
    const s = await this.prisma.pmSection.findUnique({ where: { id } });
    if (!s) throw notFound('Section');
    await this.requireDraft(s.templateId);
    return this.prisma.pmSection.update({ where: { id }, data: { ...data, updatedById: actorId } }).catch(rethrowDbError);
  }

  async deleteSection(id: string) {
    const s = await this.prisma.pmSection.findUnique({ where: { id } });
    if (!s) throw notFound('Section');
    await this.requireDraft(s.templateId);
    await this.prisma.pmSection.delete({ where: { id } }).catch(rethrowDbError);
  }

  // --- Questions (checklist items) ----------------------------------------------

  async addItem(sectionId: string, input: unknown, actorId: string) {
    const data = parseInput(ItemInput, input);
    await this.requireDraftSection(sectionId);
    const row = await this.prisma.pmChecklistItem.create({ data: { ...data, sectionId, createdById: actorId, updatedById: actorId } }).catch(rethrowDbError);
    return itemView(row);
  }

  /** The patch is merged with the stored question and the result checked as a whole. */
  async updateItem(id: string, patch: unknown, actorId: string) {
    const current = await this.prisma.pmChecklistItem.findUnique({ where: { id } });
    if (!current) throw notFound('Question');
    await this.requireDraftSection(current.sectionId);
    const merged = { ...editableItem(current), ...(typeof patch === 'object' && patch ? patch : {}) };
    const data = parseInput(ItemInput, merged);
    const row = await this.prisma.pmChecklistItem.update({ where: { id }, data: { ...data, updatedById: actorId } }).catch(rethrowDbError);
    return itemView(row);
  }

  async deleteItem(id: string) {
    const i = await this.prisma.pmChecklistItem.findUnique({ where: { id } });
    if (!i) throw notFound('Question');
    await this.requireDraftSection(i.sectionId);
    await this.prisma.pmChecklistItem.delete({ where: { id } }).catch(rethrowDbError);
  }

  // --- Readings --------------------------------------------------------------------

  async addReadingField(sectionId: string, input: unknown, actorId: string) {
    const data = parseInput(ReadingFieldInput, input);
    await this.requireDraftSection(sectionId);
    const row = await this.prisma.pmReadingField.create({ data: { ...data, sectionId, createdById: actorId, updatedById: actorId } }).catch(rethrowDbError);
    return fieldView(row);
  }

  async updateReadingField(id: string, patch: unknown, actorId: string) {
    const current = await this.prisma.pmReadingField.findUnique({ where: { id } });
    if (!current) throw notFound('Reading');
    await this.requireDraftSection(current.sectionId);
    const merged = { ...editableField(current), ...(typeof patch === 'object' && patch ? patch : {}) };
    const data = parseInput(ReadingFieldInput, merged);
    const row = await this.prisma.pmReadingField.update({ where: { id }, data: { ...data, updatedById: actorId } }).catch(rethrowDbError);
    return fieldView(row);
  }

  async deleteReadingField(id: string) {
    const f = await this.prisma.pmReadingField.findUnique({ where: { id } });
    if (!f) throw notFound('Reading');
    await this.requireDraftSection(f.sectionId);
    await this.prisma.pmReadingField.delete({ where: { id } }).catch(rethrowDbError);
  }

  // --- Consistency rules -------------------------------------------------------------

  listRules() {
    return this.prisma.pmConsistencyRule.findMany({ orderBy: [{ lhsKey: 'asc' }, { rhsKey: 'asc' }] });
  }

  async addRule(input: unknown, actorId: string) {
    const data = parseInput(ConsistencyRuleInput, input);
    return this.prisma.pmConsistencyRule.create({ data: { ...data, createdById: actorId, updatedById: actorId } }).catch(rethrowDbError);
  }

  async updateRule(id: string, patch: unknown, actorId: string) {
    const data = parseInput(ConsistencyRulePatch, patch);
    if (!(await this.prisma.pmConsistencyRule.findUnique({ where: { id } }))) throw notFound('Rule');
    return this.prisma.pmConsistencyRule.update({ where: { id }, data: { ...data, updatedById: actorId } });
  }

  // --- Helpers -------------------------------------------------------------------

  private async requireDraft(templateId: string) {
    const t = await this.prisma.pmTemplate.findUnique({ where: { id: templateId } });
    if (!t) throw notFound('Template');
    if (t.status !== 'DRAFT') throw notDraft();
    return t;
  }

  private async requireDraftSection(sectionId: string) {
    const s = await this.prisma.pmSection.findUnique({ where: { id: sectionId }, include: { template: { select: { status: true } } } });
    if (!s) throw notFound('Section');
    if (s.template.status !== 'DRAFT') throw notDraft();
    return s;
  }

  /** Serialises version changes of one template code (activate / new version). */
  private async lockCode(tx: Tx, code: string) {
    await tx.$queryRaw`SELECT id FROM pm_templates WHERE code = ${code} FOR UPDATE`;
  }
}

/** The stored question as ItemInput fields (for merging a PATCH). */
function editableItem(i: PmChecklistItem) {
  const v = itemView(i);
  return {
    code: v.code,
    prompt: v.prompt,
    helpText: v.helpText,
    responseType: v.responseType,
    options: v.options,
    allowNotApplicable: v.allowNotApplicable,
    isRequired: v.isRequired,
    unit: v.unit,
    minValue: v.minValue,
    maxValue: v.maxValue,
    isInteger: v.isInteger,
    failureOnAnswer: v.failureOnAnswer,
    failureSeverity: v.failureSeverity,
    requiresPhotoOnFailure: v.requiresPhotoOnFailure,
    requiresCommentOnFailure: v.requiresCommentOnFailure,
    photoOnAnswers: v.photoOnAnswers,
    commentOnAnswers: v.commentOnAnswers,
    photoInstructions: v.photoInstructions,
    analyticsKey: v.analyticsKey,
    sortOrder: v.sortOrder,
    isActive: v.isActive,
  };
}

function editableField(f: PmReadingField) {
  const v = fieldView(f);
  return {
    code: v.code,
    label: v.label,
    valueType: v.valueType,
    unit: v.unit,
    isInteger: v.isInteger,
    minValue: v.minValue,
    maxValue: v.maxValue,
    options: v.options,
    isRequired: v.isRequired,
    helpText: v.helpText,
    analyticsKey: v.analyticsKey,
    sortOrder: v.sortOrder,
    isActive: v.isActive,
  };
}

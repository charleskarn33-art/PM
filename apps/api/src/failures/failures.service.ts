import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user.js';
import { loadAccess } from '../authz/access.js';
import { managesRegion, siteScope, within } from '../authz/scope.js';
import { AppError } from '../common/http-exception.filter.js';
import { invalid, notFound, rethrowDbError } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import type { CorrectiveAction, Failure, Prisma } from '../generated/prisma/client.js';
import { toDate, toIso, todayIn } from '../pm/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ACTIVE_ACTION, actionNumber, failureNumber, failureStatus, failureTimestamps, nextActionStatus, type ActionStep } from './failure-rules.js';
import {
  ActionInput,
  ActionListQuery,
  ActionPatch,
  AssignInput,
  AttachmentFields,
  CommentInput,
  FailureListQuery,
  FailurePatch,
  NoteInput,
  OptionalNoteInput,
  ReportFailureInput,
  VerifyInput,
} from './failures.schemas.js';
import { sniffAttachment } from './file-type.js';

type Tx = Prisma.TransactionClient;

export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

const person = { select: { id: true, fullName: true } } as const;
const siteRef = { select: { id: true, siteCode: true, siteName: true, regionId: true } } as const;

/** Who may add to a failure's record (comments, files) besides the assignee of one of its actions. */
const CONTRIBUTE = ['failures.report', 'failures.manage', 'corrective_actions.manage'];

const failureView = <T extends Failure>(f: T) => ({ ...f, number: failureNumber(f.number) });
const actionView = <T extends CorrectiveAction>(a: T) => ({ ...a, number: actionNumber(a.number), dueDate: a.dueDate ? toIso(a.dueDate) : null });

/**
 * Failures (from completed PMs or reported on site) and the corrective-action
 * workflow that resolves them. Everyone sees failures at the sites in their
 * scope, plus those with an action assigned to them. Changes by supervisors
 * need the site to be in their regions.
 */
@Injectable()
export class FailuresService {
  private readonly logger = new Logger(FailuresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}

  // --- Scope ------------------------------------------------------------------------------

  private failureScope(caller: AuthUser): Prisma.FailureWhereInput | undefined {
    const s = siteScope(caller);
    return s ? { OR: [{ site: s }, { actions: { some: { assignedToId: caller.id } } }] } : undefined;
  }

  private actionScope(caller: AuthUser): Prisma.CorrectiveActionWhereInput | undefined {
    const s = siteScope(caller);
    return s ? { OR: [{ site: s }, { assignedToId: caller.id }] } : undefined;
  }

  /** Locks the failure if the caller can see it (otherwise "not found"). */
  private async lockFailure(tx: Tx, id: string, caller: AuthUser) {
    await tx.$queryRaw`SELECT id FROM failures WHERE id = ${id} FOR UPDATE`;
    const f = await tx.failure.findFirst({ where: within(this.failureScope(caller), { id }), include: { site: siteRef } });
    if (!f) throw notFound('Failure');
    return f;
  }

  /** Locks an action and its failure (failure first, as every change does). */
  private async lockAction(tx: Tx, id: string, caller: AuthUser) {
    const ref = await tx.correctiveAction.findFirst({ where: within(this.actionScope(caller), { id }), select: { failureId: true } });
    if (!ref) throw notFound('Corrective action');
    await tx.$queryRaw`SELECT id FROM failures WHERE id = ${ref.failureId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM corrective_actions WHERE id = ${id} FOR UPDATE`;
    const a = await tx.correctiveAction.findUniqueOrThrow({ where: { id }, include: { site: siteRef, failure: true } });
    return a;
  }

  private requireManages(caller: AuthUser, regionId: string) {
    if (!managesRegion(caller, regionId)) throw new AppError(HttpStatus.FORBIDDEN, 'NOT_YOUR_REGION', 'Only a supervisor of this site’s region can do this.');
  }

  /**
   * Brings the failure's status in line with its actions, recording the
   * change on its timeline.
   */
  private async refreshFailure(tx: Tx, failureId: string, actorId: string | null) {
    const f = await tx.failure.findUniqueOrThrow({ where: { id: failureId }, include: { actions: { select: { status: true, verifiedAt: true, closedAt: true } } } });
    const status = failureStatus({ closedByHand: f.closedById != null, reopenedAt: f.reopenedAt, actions: f.actions });
    const now = new Date();
    const stamps = failureTimestamps(status, f, now);
    if (status === f.status && stamps.resolvedAt === f.resolvedAt && stamps.verifiedAt === f.verifiedAt && stamps.closedAt === f.closedAt) return;
    await tx.failure.update({ where: { id: failureId }, data: { status, ...stamps, ...(actorId ? { updatedById: actorId } : {}) } });
    if (status !== f.status) {
      await tx.failureUpdate.create({ data: { failureId, authorId: actorId, kind: 'STATUS', fromStatus: f.status, toStatus: status } });
    }
  }

  // --- Failures ------------------------------------------------------------------------------

  async list(query: unknown, caller: AuthUser) {
    const q = parseInput(FailureListQuery, query);
    const byNumber = q.q?.match(/^(?:FL-)?0*(\d{1,9})$/i);
    const where = within(this.failureScope(caller), {
      AND: [
        q.siteId ? { siteId: q.siteId } : {},
        q.visitId ? { visitId: q.visitId } : {},
        q.status === 'active' ? { status: { not: 'CLOSED' as const } } : q.status ? { status: q.status } : {},
        q.severity ? { severity: q.severity } : {},
        q.source ? { source: q.source } : {},
        q.q ? (byNumber ? { number: Number(byNumber[1]) } : { title: { contains: q.q } }) : {},
        q.from ? { detectedAt: { gte: toDate(q.from) } } : {},
        q.to ? { detectedAt: { lt: new Date(toDate(q.to).getTime() + 86_400_000) } } : {},
      ],
    } satisfies Prisma.FailureWhereInput);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.failure.findMany({
        where,
        include: { site: siteRef, reportedBy: person, _count: { select: { actions: true } } },
        orderBy: [{ detectedAt: 'desc' }, { number: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.failure.count({ where }),
    ]);
    return { items: items.map(failureView), total, page: q.page, pageSize: q.pageSize };
  }

  /** The failure with its actions, timeline and attachments. */
  async get(id: string, caller: AuthUser) {
    const f = await this.prisma.failure.findFirst({
      where: within(this.failureScope(caller), { id }),
      include: {
        site: siteRef,
        visit: { select: { id: true, status: true, startedAt: true, completedAt: true } },
        item: { select: { id: true, code: true } },
        reportedBy: person,
        closedBy: person,
        actions: { include: { assignedTo: person }, orderBy: { number: 'asc' } },
        updates: { include: { author: person }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        attachments: { omit: { storageKey: true }, include: { uploadedBy: person }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!f) throw notFound('Failure');
    return { ...failureView(f), actions: f.actions.map(actionView) };
  }

  /** A failure found on site (not from a checklist answer). */
  async report(input: unknown, caller: AuthUser) {
    const data = parseInput(ReportFailureInput, input);
    const id = await this.prisma
      .$transaction(async (tx) => {
        if (data.id) {
          const existing = await tx.failure.findUnique({ where: { id: data.id } });
          if (existing) {
            if (existing.reportedById !== caller.id) throw new AppError(HttpStatus.CONFLICT, 'ID_CONFLICT', 'A different failure already uses this id.');
            return existing.id; // a retried report
          }
        }
        const site = await tx.site.findUnique({ where: { id: data.siteId }, select: { id: true, regionId: true, isDemo: true } });
        const assigned = site ? await tx.siteAssignment.count({ where: { siteId: site.id, userId: caller.id, active: true } }) : 0;
        if (!site || (!assigned && !managesRegion(caller, site.regionId))) throw invalid('INVALID_REFERENCE', 'The site does not exist or you do not work there.');
        const failure = await tx.failure.create({
          data: {
            id: data.id ?? randomUUID(),
            source: 'MANUAL',
            siteId: site.id,
            category: data.category ?? null,
            severity: data.severity,
            title: data.title,
            description: data.description ?? null,
            reportedById: caller.id,
            detectedAt: new Date(),
            isDemo: site.isDemo,
            createdById: caller.id,
            updatedById: caller.id,
          },
        });
        await tx.failureUpdate.create({ data: { failureId: failure.id, authorId: caller.id, kind: 'STATUS', toStatus: 'OPEN', body: 'Reported on site.' } });
        return failure.id;
      })
      .catch(rethrowDbError);
    return this.get(id, caller);
  }

  /** Title, description or severity (supervisors of the site's region). */
  async update(id: string, input: unknown, caller: AuthUser) {
    const data = parseInput(FailurePatch, input);
    await this.prisma.$transaction(async (tx) => {
      const f = await this.lockFailure(tx, id, caller);
      this.requireManages(caller, f.site.regionId);
      if (f.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'FAILURE_CLOSED', 'This failure is closed. Reopen it to change it.');
      const changes: string[] = [];
      if (data.severity && data.severity !== f.severity) changes.push(`Severity changed from ${f.severity} to ${data.severity}.`);
      if (data.title && data.title !== f.title) changes.push('Title changed.');
      if (data.description !== undefined && data.description !== f.description) changes.push('Description changed.');
      if (!changes.length) return;
      await tx.failure.update({ where: { id }, data: { ...data, updatedById: caller.id } });
      await tx.failureUpdate.create({ data: { failureId: id, authorId: caller.id, kind: 'SYSTEM', body: changes.join(' ') } });
    });
    return this.get(id, caller);
  }

  /** Closes a failure by hand, with a note — only when none of its actions is still being worked on. */
  async close(id: string, input: unknown, caller: AuthUser) {
    const { note } = parseInput(NoteInput, input);
    await this.prisma.$transaction(async (tx) => {
      const f = await this.lockFailure(tx, id, caller);
      this.requireManages(caller, f.site.regionId);
      if (f.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'FAILURE_CLOSED', 'This failure is already closed.');
      const open = await tx.correctiveAction.count({ where: { failureId: id, status: { in: [...ACTIVE_ACTION] } } });
      if (open) throw new AppError(HttpStatus.CONFLICT, 'ACTIONS_OPEN', 'Corrective actions of this failure are still open. Finish or withdraw them first.');
      await tx.failure.update({ where: { id }, data: { closedById: caller.id, closeNote: note, updatedById: caller.id } });
      await tx.failureUpdate.create({ data: { failureId: id, authorId: caller.id, kind: 'COMMENT', body: note } });
      await this.refreshFailure(tx, id, caller.id);
    });
    return this.get(id, caller);
  }

  /** The problem is back (or was closed by mistake): the failure is open again; earlier closed actions no longer count. */
  async reopen(id: string, input: unknown, caller: AuthUser) {
    const { note } = parseInput(NoteInput, input);
    await this.prisma.$transaction(async (tx) => {
      const f = await this.lockFailure(tx, id, caller);
      this.requireManages(caller, f.site.regionId);
      if (f.status !== 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'FAILURE_NOT_CLOSED', 'Only a closed failure can be reopened.');
      await tx.failure.update({ where: { id }, data: { closedById: null, closeNote: null, reopenedAt: new Date(), updatedById: caller.id } });
      await tx.failureUpdate.create({ data: { failureId: id, authorId: caller.id, kind: 'COMMENT', body: note } });
      await this.refreshFailure(tx, id, caller.id);
    });
    return this.get(id, caller);
  }

  // --- Comments and attachments ------------------------------------------------------------------

  /** May the caller add to this failure's record (optionally on one of its actions)? */
  private async requireContributor(tx: Tx, failureId: string, actionId: string | undefined, caller: AuthUser) {
    let action: CorrectiveAction | null = null;
    if (actionId) {
      action = await tx.correctiveAction.findFirst({ where: { id: actionId, failureId } });
      if (!action) throw invalid('INVALID_REFERENCE', 'The corrective action is not part of this failure.');
    }
    const assignee = action ? action.assignedToId === caller.id : (await tx.correctiveAction.count({ where: { failureId, assignedToId: caller.id } })) > 0;
    if (!assignee && !CONTRIBUTE.some((p) => caller.permissions.includes(p))) {
      throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You cannot add to this failure.');
    }
    return action;
  }

  async comment(failureId: string, input: unknown, caller: AuthUser) {
    const data = parseInput(CommentInput, input);
    const update = await this.prisma.$transaction(async (tx) => {
      await this.lockFailure(tx, failureId, caller);
      await this.requireContributor(tx, failureId, data.correctiveActionId, caller);
      return tx.failureUpdate.create({
        data: { failureId, correctiveActionId: data.correctiveActionId ?? null, authorId: caller.id, kind: 'COMMENT', body: data.body },
        include: { author: person },
      });
    });
    return update;
  }

  async addAttachment(failureId: string, file: UploadedFile | undefined, fields: unknown, caller: AuthUser) {
    const data = parseInput(AttachmentFields, fields ?? {});
    if (!file || file.size === 0) throw invalid('FILE_REQUIRED', 'Attach the file as the "file" field.');
    const type = sniffAttachment(file.buffer);
    if (!type) throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_MEDIA_TYPE', 'Attach a photo (JPEG, PNG or WebP) or a PDF document.');
    const max = type.kind === 'PHOTO' ? this.config.photoMaxBytes : this.config.documentMaxBytes;
    if (file.size > max) throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', `A ${type.kind === 'PHOTO' ? 'photo' : 'document'} can be at most ${Math.floor(max / 1_000_000)} MB.`);

    // Checks first: no file is written for a request that will be refused.
    await this.prisma.$transaction(async (tx) => {
      const f = await this.lockFailure(tx, failureId, caller);
      if (f.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'FAILURE_CLOSED', 'This failure is closed. Reopen it to add files.');
      await this.requireContributor(tx, failureId, data.correctiveActionId, caller);
    });
    if (data.id) {
      const existing = await this.prisma.failureAttachment.findUnique({ where: { id: data.id }, omit: { storageKey: true } });
      if (existing) {
        if (existing.failureId !== failureId || existing.uploadedById !== caller.id) throw new AppError(HttpStatus.CONFLICT, 'ID_CONFLICT', 'A different file already uses this id.');
        return existing; // a retried upload
      }
    }
    const id = data.id ?? randomUUID();
    const storageKey = `failures/${failureId}/${id}.${type.ext}`;
    // The name as given, without path separators or control characters.
    const given = [...(file.originalname ?? '')].filter((c) => c !== '/' && c !== '\\' && c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join('');
    const fileName = given.trim().slice(0, 255) || `${id}.${type.ext}`;
    await this.storage.put(storageKey, file.buffer, type.contentType);
    try {
      return await this.prisma.failureAttachment.create({
        data: {
          id,
          failureId,
          correctiveActionId: data.correctiveActionId ?? null,
          kind: type.kind,
          storageKey,
          fileName,
          contentType: type.contentType,
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          caption: data.caption || null,
          uploadedById: caller.id,
        },
        omit: { storageKey: true },
      });
    } catch (e) {
      await this.storage.delete(storageKey).catch((err: unknown) => this.logger.error({ err, storageKey }, 'Could not remove an orphaned attachment'));
      return rethrowDbError(e);
    }
  }

  async attachmentFile(failureId: string, attachmentId: string, caller: AuthUser) {
    const a = await this.prisma.failureAttachment.findFirst({ where: { id: attachmentId, failureId, failure: within(this.failureScope(caller), {}) } });
    if (!a) throw notFound('Attachment');
    return { data: await this.storage.get(a.storageKey), contentType: a.contentType, fileName: a.fileName, kind: a.kind };
  }

  /** The uploader, or a supervisor of the site's region, while the failure is open. */
  async deleteAttachment(failureId: string, attachmentId: string, caller: AuthUser) {
    const key = await this.prisma.$transaction(async (tx) => {
      const f = await this.lockFailure(tx, failureId, caller);
      const a = await tx.failureAttachment.findFirst({ where: { id: attachmentId, failureId } });
      if (!a) throw notFound('Attachment');
      if (a.uploadedById !== caller.id && !(caller.permissions.includes('failures.manage') && managesRegion(caller, f.site.regionId))) {
        throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Only the person who added this file or a supervisor can remove it.');
      }
      if (f.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'FAILURE_CLOSED', 'This failure is closed.');
      await tx.failureAttachment.delete({ where: { id: attachmentId } });
      await tx.failureUpdate.create({ data: { failureId, correctiveActionId: a.correctiveActionId, authorId: caller.id, kind: 'SYSTEM', body: `Removed ${a.kind === 'PHOTO' ? 'photo' : 'document'} ${a.fileName}.` } });
      return a.storageKey;
    });
    await this.storage.delete(key).catch((err: unknown) => this.logger.error({ err, key }, 'Could not remove a deleted attachment'));
  }

  // --- Corrective actions ---------------------------------------------------------------------------

  async listActions(query: unknown, caller: AuthUser) {
    const q = parseInput(ActionListQuery, query);
    const today = toDate(todayIn(this.config.orgTimezone));
    const where = within(this.actionScope(caller), {
      AND: [
        q.status === 'active' ? { status: { in: [...ACTIVE_ACTION] } } : q.status ? { status: q.status } : {},
        q.assignedTo ? { assignedToId: q.assignedTo === 'me' ? caller.id : q.assignedTo } : {},
        q.siteId ? { siteId: q.siteId } : {},
        q.failureId ? { failureId: q.failureId } : {},
        q.overdue ? { status: { in: [...ACTIVE_ACTION] }, dueDate: { lt: today } } : {},
      ],
    } satisfies Prisma.CorrectiveActionWhereInput);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.correctiveAction.findMany({
        where,
        include: { site: siteRef, assignedTo: person, failure: { select: { id: true, number: true, title: true, severity: true, status: true } } },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { number: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.correctiveAction.count({ where }),
    ]);
    return {
      items: items.map((a) => ({ ...actionView(a), failure: failureView(a.failure as Failure) })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async getAction(id: string, caller: AuthUser) {
    const a = await this.prisma.correctiveAction.findFirst({
      where: within(this.actionScope(caller), { id }),
      include: {
        site: siteRef,
        failure: { include: { visit: { select: { id: true, startedAt: true } } } },
        assignedTo: person,
        assignedBy: person,
        completedBy: person,
        verifiedBy: person,
        closedBy: person,
        updates: { where: { correctiveActionId: id }, include: { author: person }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        attachments: { omit: { storageKey: true }, include: { uploadedBy: person }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!a) throw notFound('Corrective action');
    return { ...actionView(a), failure: failureView(a.failure) };
  }

  /** The assignee must be an active user who works on corrective actions at this site. */
  private async requireAssignee(tx: Tx, userId: string, siteId: string) {
    const access = await loadAccess(tx, userId);
    if (!access?.isActive || !access.permissions.includes('corrective_actions.work')) {
      throw invalid('INVALID_ASSIGNEE', 'Assign the action to an active user who works on corrective actions.');
    }
    const works = await tx.site.count({ where: within(siteScope(access), { id: siteId }) });
    if (!works) throw invalid('INVALID_ASSIGNEE', 'This person does not work at this site (not assigned to it and not in its region).');
    return access;
  }

  async createAction(input: unknown, caller: AuthUser) {
    const data = parseInput(ActionInput, input);
    const id = await this.prisma
      .$transaction(async (tx) => {
        if (data.id && (await tx.correctiveAction.findUnique({ where: { id: data.id } }))) {
          const existing = await tx.correctiveAction.findUniqueOrThrow({ where: { id: data.id } });
          if (existing.createdById !== caller.id || existing.failureId !== data.failureId) throw new AppError(HttpStatus.CONFLICT, 'ID_CONFLICT', 'A different action already uses this id.');
          return existing.id;
        }
        const f = await this.lockFailure(tx, data.failureId, caller).catch(() => {
          throw invalid('INVALID_REFERENCE', 'The failure does not exist.');
        });
        this.requireManages(caller, f.site.regionId);
        if (f.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'FAILURE_CLOSED', 'This failure is closed. Reopen it to add an action.');
        const assignee = data.assignedToId ? await this.requireAssignee(tx, data.assignedToId, f.siteId) : null;
        const now = new Date();
        const action = await tx.correctiveAction.create({
          data: {
            id: data.id ?? randomUUID(),
            failureId: f.id,
            siteId: f.siteId,
            title: data.title,
            description: data.description ?? null,
            priority: data.priority,
            status: assignee ? 'ASSIGNED' : 'OPEN',
            assignedToId: assignee?.id ?? null,
            assignedById: assignee ? caller.id : null,
            assignedAt: assignee ? now : null,
            dueDate: data.dueDate ? toDate(data.dueDate) : null,
            isDemo: f.isDemo,
            createdById: caller.id,
            updatedById: caller.id,
          },
        });
        await tx.failureUpdate.create({
          data: {
            failureId: f.id,
            correctiveActionId: action.id,
            authorId: caller.id,
            kind: 'STATUS',
            toStatus: action.status,
            body: `Corrective action ${actionNumber(action.number)} created${assignee ? ` and assigned to ${assignee.fullName}` : ''}.`,
          },
        });
        await this.refreshFailure(tx, f.id, caller.id);
        return action.id;
      })
      .catch(rethrowDbError);
    return this.getAction(id, caller);
  }

  async updateAction(id: string, input: unknown, caller: AuthUser) {
    const data = parseInput(ActionPatch, input);
    await this.prisma.$transaction(async (tx) => {
      const a = await this.lockAction(tx, id, caller);
      this.requireManages(caller, a.site.regionId);
      if (a.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'ACTION_CLOSED', 'This action is closed.');
      await tx.correctiveAction.update({
        where: { id },
        data: {
          ...(data.title ? { title: data.title } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.priority ? { priority: data.priority } : {}),
          ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? toDate(data.dueDate) : null } : {}),
          updatedById: caller.id,
        },
      });
      await tx.failureUpdate.create({ data: { failureId: a.failureId, correctiveActionId: id, authorId: caller.id, kind: 'SYSTEM', body: 'Action details changed.' } });
    });
    return this.getAction(id, caller);
  }

  /** One workflow step: checks who may take it, records it on the timeline and updates the failure. */
  private async step(
    id: string,
    step: ActionStep,
    caller: AuthUser,
    apply: (tx: Tx, a: Awaited<ReturnType<FailuresService['lockAction']>>) => Promise<{ data: Prisma.CorrectiveActionUpdateInput; body?: string | null }>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const a = await this.lockAction(tx, id, caller);
      const to = nextActionStatus(a.status, step);
      if (!to) throw new AppError(HttpStatus.CONFLICT, 'INVALID_TRANSITION', `This action is ${a.status.toLowerCase().replace('_', ' ')}; it cannot be ${STEP_TEXT[step]} now.`);
      const { data, body } = await apply(tx, a);
      await tx.correctiveAction.update({ where: { id }, data: { ...data, status: to, updatedById: caller.id } });
      await tx.failureUpdate.create({ data: { failureId: a.failureId, correctiveActionId: id, authorId: caller.id, kind: 'STATUS', fromStatus: a.status, toStatus: to, body: body ?? null } });
      await this.refreshFailure(tx, a.failureId, caller.id);
    });
    return this.getAction(id, caller);
  }

  private requireAssigned(a: CorrectiveAction, caller: AuthUser) {
    if (a.assignedToId !== caller.id) throw new AppError(HttpStatus.FORBIDDEN, 'NOT_ASSIGNEE', 'Only the person this action is assigned to can do this.');
  }

  assign(id: string, input: unknown, caller: AuthUser) {
    const data = parseInput(AssignInput, input);
    return this.step(id, 'assign', caller, async (tx, a) => {
      this.requireManages(caller, a.site.regionId);
      const assignee = await this.requireAssignee(tx, data.assignedToId, a.siteId);
      const reassigned = a.assignedToId !== assignee.id;
      return {
        data: {
          assignedTo: { connect: { id: assignee.id } },
          assignedBy: { connect: { id: caller.id } },
          assignedAt: new Date(),
          ...(reassigned ? { startedAt: null } : {}),
          ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? toDate(data.dueDate) : null } : {}),
        },
        body: `Assigned to ${assignee.fullName}.`,
      };
    });
  }

  start(id: string, caller: AuthUser) {
    return this.step(id, 'start', caller, async (_tx, a) => {
      this.requireAssigned(a, caller);
      return { data: { startedAt: new Date() } };
    });
  }

  complete(id: string, input: unknown, caller: AuthUser) {
    const { note } = parseInput(NoteInput, input);
    return this.step(id, 'complete', caller, async (_tx, a) => {
      this.requireAssigned(a, caller);
      return { data: { completedAt: new Date(), completedBy: { connect: { id: caller.id } }, completionNote: note }, body: note };
    });
  }

  /** A supervisor checks the work: approve (verified) or send it back (in progress). Not by the person who did it. */
  verify(id: string, input: unknown, caller: AuthUser) {
    const data = parseInput(VerifyInput, input);
    return this.step(id, data.decision === 'APPROVE' ? 'approve' : 'reject', caller, async (_tx, a) => {
      this.requireManages(caller, a.site.regionId);
      if (a.assignedToId === caller.id || a.completedById === caller.id) {
        throw new AppError(HttpStatus.FORBIDDEN, 'SAME_PERSON', 'The person who did the work cannot verify it.');
      }
      if (data.decision === 'APPROVE') {
        return { data: { verifiedAt: new Date(), verifiedBy: { connect: { id: caller.id } }, verificationNote: data.note ?? null }, body: data.note ?? 'Verified.' };
      }
      return { data: { completedAt: null, completedBy: { disconnect: true }, completionNote: null }, body: data.note };
    });
  }

  /** Closes a verified action, or withdraws one not started yet (with a note). */
  closeAction(id: string, input: unknown, caller: AuthUser) {
    const { note } = parseInput(OptionalNoteInput, input);
    return this.step(id, 'close', caller, async (_tx, a) => {
      this.requireManages(caller, a.site.regionId);
      if (a.status !== 'VERIFIED' && !note) throw invalid('NOTE_REQUIRED', 'Say why the action is withdrawn.', [{ path: 'note', message: 'required' }]);
      return { data: { closedAt: new Date(), closedBy: { connect: { id: caller.id } }, closeNote: note ?? null }, body: note ?? (a.status === 'VERIFIED' ? 'Closed.' : null) };
    });
  }

  /** Comments and files on an action go on its failure's record, marked with the action. */
  async actionFailureId(id: string, caller: AuthUser): Promise<string> {
    const a = await this.prisma.correctiveAction.findFirst({ where: within(this.actionScope(caller), { id }), select: { failureId: true } });
    if (!a) throw notFound('Corrective action');
    return a.failureId;
  }
}

const STEP_TEXT: Record<ActionStep, string> = {
  assign: 'assigned',
  start: 'started',
  complete: 'completed',
  approve: 'verified',
  reject: 'sent back',
  close: 'closed',
};

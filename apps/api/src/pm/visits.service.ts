import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user.js';
import { managesRegion, siteScope, within } from '../authz/scope.js';
import { AppError } from '../common/http-exception.filter.js';
import { invalid, notFound, rethrowDbError } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import type { PmStatus, PmVisit, Prisma, SiteEquipment } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { evaluateGeofence } from './geofence.js';
import { toDate, toIso } from './dates.js';
import {
  isEmptyResponse,
  isFailure,
  normalizeReading,
  normalizeResponse,
  visitIssues,
  visitProgress,
  type ReadingValues,
  type ResponseValues,
} from './engine.js';
import { sniffImage } from './image-type.js';
import { fieldView, itemView, moduleView, num, stringList, toEngineField, toEngineItem, toEngineRule } from './mapping.js';
import { batteryUnitRequirement, loadStructure, loadVisitState, refreshProgress } from './visit-state.js';
import { AnswersInput, BatteryUnitsInput, PhotoFields, ReviewInput, SignatureInput, StartVisitInput, VisitListQuery } from './visits.schemas.js';

type Tx = Prisma.TransactionClient;

/** Visits the technician may still edit (a rejected visit goes back to work). */
const EDITABLE: PmStatus[] = ['IN_PROGRESS', 'REJECTED'];
const EQUIPMENT_FLAG: Record<SiteEquipment, 'generatorAvailable' | 'solarAvailable' | 'gridAvailable'> = {
  GENERATOR: 'generatorAvailable',
  SOLAR: 'solarAvailable',
  GRID: 'gridAvailable',
};

const LIST_INCLUDE = {
  site: { select: { id: true, siteCode: true, siteName: true, regionId: true } },
  technician: { select: { id: true, fullName: true } },
  template: { select: { id: true, code: true, name: true, version: true } },
} as const;

export interface UploadedFile {
  buffer: Buffer;
  size: number;
}

/**
 * PM visits: a technician starts a visit at an assigned site, records answers,
 * readings and photos (checked against the template version the visit started
 * on), completes it when nothing required is missing, and a supervisor
 * approves it or returns it for correction.
 */
@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  // --- Start -----------------------------------------------------------------------

  async start(input: unknown, caller: AuthUser) {
    const data = parseInput(StartVisitInput, input);
    const id = await this.prisma
      .$transaction(async (tx) => {
        if (data.id) {
          const existing = await tx.pmVisit.findUnique({ where: { id: data.id } });
          if (existing) {
            if (existing.technicianId !== caller.id) throw new AppError(HttpStatus.CONFLICT, 'ID_CONFLICT', 'A different visit already uses this id.');
            return existing.id; // a retried start (e.g. from an offline phone)
          }
        }

        let siteId: string;
        let templateId: string;
        let scheduleId: string | null = null;
        if (data.scheduleId) {
          await tx.$queryRaw`SELECT id FROM pm_schedules WHERE id = ${data.scheduleId} FOR UPDATE`;
          const schedule = await tx.pmSchedule.findUnique({ where: { id: data.scheduleId } });
          if (!schedule) throw invalid('INVALID_REFERENCE', 'The schedule does not exist.');
          await this.requireAssigned(tx, schedule.siteId, caller.id);
          if (schedule.technicianId && schedule.technicianId !== caller.id) {
            throw new AppError(HttpStatus.FORBIDDEN, 'NOT_YOUR_SCHEDULE', 'This PM is scheduled for another technician.');
          }
          const open = await tx.pmVisit.findFirst({ where: { scheduleId: schedule.id, status: { in: EDITABLE } } });
          if (open) {
            if (open.technicianId === caller.id) return open.id;
            throw new AppError(HttpStatus.CONFLICT, 'VISIT_IN_PROGRESS', 'Another technician has already started this PM.');
          }
          if (schedule.status !== 'SCHEDULED' && schedule.status !== 'OVERDUE') {
            throw invalid('SCHEDULE_NOT_OPEN', 'This PM is not open (it is completed or cancelled).');
          }
          siteId = schedule.siteId;
          templateId = schedule.templateId;
          scheduleId = schedule.id;
          await tx.pmSchedule.update({
            where: { id: schedule.id },
            data: { status: 'IN_PROGRESS', technicianId: schedule.technicianId ?? caller.id, updatedById: caller.id },
          });
        } else {
          siteId = data.siteId!;
          await this.requireAssigned(tx, siteId, caller.id);
          const active = await tx.pmTemplate.findMany({ where: { status: 'ACTIVE', ...(data.templateCode ? { code: data.templateCode.toUpperCase() } : {}) } });
          if (active.length !== 1) {
            throw invalid(active.length ? 'TEMPLATE_REQUIRED' : 'NO_ACTIVE_TEMPLATE', active.length ? 'Several templates are active: give the template code.' : 'There is no active PM template.');
          }
          templateId = active[0]!.id;
        }

        const site = await tx.site.findUniqueOrThrow({ where: { id: siteId } });
        if (site.status !== 'ACTIVE') throw invalid('SITE_NOT_ACTIVE', 'PM can only be started at an active site.');

        // Geofence. The position is what the phone reports; it is recorded with the result.
        const fence = await this.settings.get('geofence');
        const geo = evaluateGeofence({
          site: { latitude: num(site.latitude), longitude: num(site.longitude), geofenceRadiusM: site.geofenceRadiusM },
          defaultRadiusM: fence.radiusM,
          mode: fence.mode,
          position: data.gps ?? null,
        });
        const where = geo.distanceM == null ? 'Your location is unavailable' : `You are ${Math.round(geo.distanceM)} m from the site`;
        if (geo.blocked) {
          throw invalid('OUTSIDE_GEOFENCE', `${where}. PM can only be started within ${geo.radiusM} m of the site.`, { status: geo.status, distanceM: geo.distanceM, radiusM: geo.radiusM });
        }
        if (geo.reasonRequired && !data.outsideRadiusReason) {
          throw invalid('REASON_REQUIRED', `${where} (allowed: ${geo.radiusM} m). Give the reason for starting PM here.`, { status: geo.status, distanceM: geo.distanceM, radiusM: geo.radiusM });
        }
        // Sections for equipment the site does not have start as not applicable.
        const sections = await tx.pmSection.findMany({ where: { templateId, isActive: true } });
        const notApplicable = sections.filter((s) => s.allowNotApplicable && s.requiresEquipment && !site[EQUIPMENT_FLAG[s.requiresEquipment]]).map((s) => s.code);

        const visit = await tx.pmVisit.create({
          data: {
            id: data.id ?? randomUUID(),
            scheduleId,
            siteId,
            templateId,
            technicianId: caller.id,
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            notApplicableSections: notApplicable,
            clientCreatedAt: data.clientCreatedAt ? new Date(data.clientCreatedAt) : null,
            gpsLatitude: data.gps?.latitude ?? null,
            gpsLongitude: data.gps?.longitude ?? null,
            gpsAccuracyM: data.gps?.accuracyM ?? null,
            gpsCapturedAt: data.gps?.capturedAt ? new Date(data.gps.capturedAt) : data.gps ? new Date() : null,
            gpsDistanceM: geo.distanceM == null ? null : Math.round(geo.distanceM * 100) / 100,
            gpsRadiusM: geo.radiusM,
            gpsStatus: geo.status,
            geofenceMode: geo.mode,
            outsideRadiusReason: geo.status === 'OUTSIDE_RADIUS' || geo.status === 'UNAVAILABLE' ? (data.outsideRadiusReason ?? null) : null,
            createdById: caller.id,
            updatedById: caller.id,
          },
        });
        await this.refreshProgress(tx, visit);
        return visit.id;
      })
      .catch(rethrowDbError);
    return this.get(id, caller);
  }

  // --- Answers and readings ----------------------------------------------------------

  /**
   * Saves answers and readings (all or nothing: one invalid value rejects the
   * batch with every problem listed). An answer with no value clears it. A
   * value recorded on the phone before the stored one is ignored and listed
   * under `skipped`.
   */
  async saveAnswers(visitId: string, input: unknown, caller: AuthUser) {
    const data = parseInput(AnswersInput, input);
    const skipped = await this.prisma
      .$transaction(async (tx) => {
        const visit = await this.requireOwnEditable(tx, visitId, caller);
        const structure = await loadStructure(tx, visit.templateId);
        const items = new Map(structure.items.map((i) => [i.id, i]));
        const fields = new Map(structure.fields.map((f) => [f.id, f]));
        const problems: { path: string; message: string }[] = [];

        let notApplicable: string[] | undefined;
        if (data.notApplicableSections) {
          notApplicable = [...new Set(data.notApplicableSections)];
          notApplicable.forEach((code, i) => {
            const s = structure.sections.find((x) => x.code === code && x.isActive);
            if (!s) problems.push({ path: `notApplicableSections.${i}`, message: `no section ${code} in this template` });
            else if (!s.allowNotApplicable) problems.push({ path: `notApplicableSections.${i}`, message: `${s.name} cannot be marked not applicable` });
          });
        }

        const responses: { itemId: string; values: ResponseValues; clientUpdatedAt: Date | null }[] = [];
        data.responses.forEach((r, i) => {
          const item = items.get(r.checklistItemId);
          if (!item || !item.isActive) return problems.push({ path: `responses.${i}.checklistItemId`, message: 'not a question of this visit’s template' });
          const res = normalizeResponse(toEngineItem(item), {
            answer: r.answer ?? null,
            numericValue: r.numericValue ?? null,
            textValue: r.textValue ?? null,
            selectedOptions: r.selectedOptions ?? null,
            dateValue: r.dateValue ?? null,
            datetimeValue: r.datetimeValue ?? null,
            comment: r.comment ?? null,
          });
          if (!res.ok) return problems.push({ path: `responses.${i}`, message: res.error });
          responses.push({ itemId: item.id, values: res.value, clientUpdatedAt: r.clientUpdatedAt ? new Date(r.clientUpdatedAt) : null });
        });

        const readings: { fieldId: string; values: ReadingValues; clientUpdatedAt: Date | null }[] = [];
        data.readings.forEach((r, i) => {
          const field = fields.get(r.readingFieldId);
          if (!field || !field.isActive) return problems.push({ path: `readings.${i}.readingFieldId`, message: 'not a reading of this visit’s template' });
          const res = normalizeReading(toEngineField(field), { numericValue: r.numericValue ?? null, textValue: r.textValue ?? null });
          if (!res.ok) return problems.push({ path: `readings.${i}`, message: res.error });
          readings.push({ fieldId: field.id, values: res.value, clientUpdatedAt: r.clientUpdatedAt ? new Date(r.clientUpdatedAt) : null });
        });

        if (problems.length) throw invalid('VALIDATION_FAILED', 'Some answers are not valid. Nothing was saved.', problems);

        const skipped: { type: 'response' | 'reading'; id: string }[] = [];
        const now = new Date();
        for (const r of responses) {
          const stored = await tx.pmResponse.findUnique({ where: { visitId_checklistItemId: { visitId, checklistItemId: r.itemId } } });
          if (stored?.clientUpdatedAt && r.clientUpdatedAt && r.clientUpdatedAt < stored.clientUpdatedAt) {
            skipped.push({ type: 'response', id: r.itemId });
            continue;
          }
          if (isEmptyResponse(r.values)) {
            if (stored) await tx.pmResponse.delete({ where: { id: stored.id } });
            continue;
          }
          const item = items.get(r.itemId)!;
          const values = {
            answer: r.values.answer,
            numericValue: r.values.numericValue,
            textValue: r.values.textValue,
            selectedOptions: r.values.selectedOptions ?? undefined,
            dateValue: r.values.dateValue ? toDate(r.values.dateValue) : null,
            datetimeValue: r.values.datetimeValue ? new Date(r.values.datetimeValue) : null,
            comment: r.values.comment,
            isFailure: isFailure(toEngineItem(item), r.values.answer),
            promptSnapshot: item.prompt,
            unitSnapshot: item.unit,
            answeredAt: now,
            answeredById: caller.id,
            clientUpdatedAt: r.clientUpdatedAt,
          };
          await tx.pmResponse.upsert({
            where: { visitId_checklistItemId: { visitId, checklistItemId: r.itemId } },
            create: { visitId, checklistItemId: r.itemId, ...values },
            update: { ...values, selectedOptions: r.values.selectedOptions ?? [] },
          });
        }
        for (const r of readings) {
          const stored = await tx.pmReading.findUnique({ where: { visitId_readingFieldId: { visitId, readingFieldId: r.fieldId } } });
          if (stored?.clientUpdatedAt && r.clientUpdatedAt && r.clientUpdatedAt < stored.clientUpdatedAt) {
            skipped.push({ type: 'reading', id: r.fieldId });
            continue;
          }
          if (r.values.numericValue == null && r.values.textValue == null) {
            if (stored) await tx.pmReading.delete({ where: { id: stored.id } });
            continue;
          }
          const field = fields.get(r.fieldId)!;
          const values = {
            numericValue: r.values.numericValue,
            textValue: r.values.textValue,
            labelSnapshot: field.label,
            unitSnapshot: field.unit,
            capturedAt: now,
            clientUpdatedAt: r.clientUpdatedAt,
          };
          await tx.pmReading.upsert({
            where: { visitId_readingFieldId: { visitId, readingFieldId: r.fieldId } },
            create: { visitId, readingFieldId: r.fieldId, ...values },
            update: values,
          });
        }

        await this.clearSignature(tx, visit);
        const updated = await tx.pmVisit.update({
          where: { id: visitId },
          data: {
            ...(notApplicable ? { notApplicableSections: notApplicable } : {}),
            ...(data.overallComments !== undefined ? { overallComments: data.overallComments } : {}),
            ...(visit.status === 'REJECTED' ? { status: 'IN_PROGRESS' as const } : {}),
            updatedById: caller.id,
          },
        });
        if (visit.status === 'REJECTED' && visit.scheduleId) {
          await tx.pmSchedule.update({ where: { id: visit.scheduleId }, data: { status: 'IN_PROGRESS' } });
        }
        await this.refreshProgress(tx, updated);
        return skipped;
      })
      .catch(rethrowDbError);
    return { ...(await this.get(visitId, caller)), skipped };
  }

  // --- Complete and review ---------------------------------------------------------------

  /** Finishes the visit when nothing blocks it; otherwise lists what is missing. */
  async complete(visitId: string, caller: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      const visit = await this.requireOwnEditable(tx, visitId, caller);
      const state = await loadVisitState(tx, visit);
      const issues = [...visitIssues(state), ...(await this.signatureIssue(visit))];
      if (issues.length) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VISIT_INCOMPLETE',
          `Unable to complete: ${issues.length} item${issues.length === 1 ? ' needs' : 's need'} attention.`,
          issues,
        );
      }
      const progress = visitProgress(state);
      await tx.pmVisit.update({
        where: { id: visitId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completionPct: progress.completionPct,
          failureCount: progress.failureCount,
          reviewedById: null,
          reviewedAt: null,
          updatedById: caller.id,
        },
      });
      if (visit.scheduleId) await tx.pmSchedule.update({ where: { id: visit.scheduleId }, data: { status: 'COMPLETED' } });
    });
    return this.get(visitId, caller);
  }

  /** A supervisor approves a completed visit, or returns it to the technician with comments. */
  async review(visitId: string, input: unknown, caller: AuthUser) {
    const data = parseInput(ReviewInput, input);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pm_visits WHERE id = ${visitId} FOR UPDATE`;
      const visit = await tx.pmVisit.findUnique({ where: { id: visitId }, include: { site: { select: { regionId: true } } } });
      if (!visit || !managesRegion(caller, visit.site.regionId)) throw notFound('Visit');
      if (visit.technicianId === caller.id) throw new AppError(HttpStatus.FORBIDDEN, 'OWN_VISIT', 'You cannot review your own PM.');
      if (visit.status !== 'COMPLETED') throw invalid('VISIT_NOT_COMPLETED', 'Only a completed PM can be reviewed.');
      const status = data.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.pmVisit.update({
        where: { id: visitId },
        data: { status, reviewedById: caller.id, reviewedAt: new Date(), reviewComments: data.comments, updatedById: caller.id },
      });
      if (visit.scheduleId) await tx.pmSchedule.update({ where: { id: visit.scheduleId }, data: { status } });
    });
    return this.get(visitId, caller);
  }

  // --- Reading ---------------------------------------------------------------------------

  async list(query: unknown, caller: AuthUser) {
    const q = parseInput(VisitListQuery, query);
    const scope = siteScope(caller);
    const where = within<Prisma.PmVisitWhereInput>(scope ? { site: scope } : undefined, {
      AND: [
        q.siteId ? { siteId: q.siteId } : {},
        q.technicianId ? { technicianId: q.technicianId } : {},
        q.mine ? { technicianId: caller.id } : {},
        q.status ? { status: q.status } : {},
        q.from ? { startedAt: { gte: toDate(q.from) } } : {},
        q.to ? { startedAt: { lt: new Date(toDate(q.to).getTime() + 86_400_000) } } : {},
      ],
    });
    const [items, total] = await this.prisma.$transaction([
      this.prisma.pmVisit.findMany({ where, include: LIST_INCLUDE, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.pmVisit.count({ where }),
    ]);
    return {
      items: items.map((v) => ({ ...v, completionPct: num(v.completionPct), notApplicableSections: stringList(v.notApplicableSections) })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** The visit with its template structure, answers, readings, photos, progress and open issues. */
  async get(visitId: string, caller: AuthUser) {
    const scope = siteScope(caller);
    const visit = await this.prisma.pmVisit.findFirst({
      where: within<Prisma.PmVisitWhereInput>(scope ? { site: scope } : undefined, { id: visitId }),
      include: {
        ...LIST_INCLUDE,
        schedule: { select: { id: true, scheduledDate: true, dueDate: true, priority: true } },
        reviewedBy: { select: { id: true, fullName: true } },
        generator: true,
        dc: true,
        dcPhases: { orderBy: { phaseNumber: 'asc' } },
        battery: true,
        batteryUnits: { orderBy: { unitNumber: 'asc' } },
        solar: true,
        nonTechnical: true,
        earthing: true,
      },
    });
    if (!visit) throw notFound('Visit');
    const { generator, dc, dcPhases, battery, batteryUnits, solar, nonTechnical, earthing, signatureKey: _key, ...rest } = visit;
    const visitRow = { ...rest, gpsLatitude: num(rest.gpsLatitude), gpsLongitude: num(rest.gpsLongitude), gpsAccuracyM: num(rest.gpsAccuracyM), gpsDistanceM: num(rest.gpsDistanceM) };
    const [structure, responses, readings, photos, state, rules, batteryRequirement, pmSettings] = await Promise.all([
      loadStructure(this.prisma, visit.templateId),
      this.prisma.pmResponse.findMany({ where: { visitId } }),
      this.prisma.pmReading.findMany({ where: { visitId } }),
      this.prisma.pmPhoto.findMany({ where: { visitId }, orderBy: { createdAt: 'asc' }, omit: { storageKey: true } }),
      loadVisitState(this.prisma, visit),
      this.prisma.pmConsistencyRule.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
      batteryUnitRequirement(this.prisma, visit),
      this.settings.get('pm'),
    ]);
    const progress = visitProgress(state);
    return {
      ...visitRow,
      completionPct: num(visit.completionPct),
      notApplicableSections: stringList(visit.notApplicableSections),
      schedule: visit.schedule ? { ...visit.schedule, scheduledDate: toIso(visit.schedule.scheduledDate), dueDate: toIso(visit.schedule.dueDate) } : null,
      sections: structure.sections
        .filter((s) => s.isActive)
        .map((s) => ({
          ...s,
          items: structure.items.filter((i) => i.sectionId === s.id && i.isActive).map(itemView),
          readingFields: structure.fields.filter((f) => f.sectionId === s.id && f.isActive).map(fieldView),
        })),
      responses: responses.map((r) => ({
        ...r,
        numericValue: num(r.numericValue),
        selectedOptions: r.selectedOptions == null ? null : stringList(r.selectedOptions),
        dateValue: r.dateValue ? toIso(r.dateValue) : null,
      })),
      readings: readings.map((r) => ({ ...r, numericValue: num(r.numericValue) })),
      photos,
      /** Power-module records built from this visit's data (null: section not applicable). */
      modules: moduleView({ generator, dc, dcPhases, battery, batteryUnits, solar, nonTechnical, earthing }),
      progress,
      issues: EDITABLE.includes(visit.status) ? [...visitIssues(state), ...(await this.signatureIssue(visit))] : [],
      signature: visit.signedAt ? { signedAt: visit.signedAt, signedName: visit.signedName } : null,
      /** What the phone needs to judge the visit offline with the same engine rules. */
      engine: { rules: rules.map(toEngineRule), batteryUnits: batteryRequirement, requireSignature: pmSettings.requireSignature },
    };
  }

  // --- Signature ----------------------------------------------------------------------------

  /**
   * The technician signs the visit (normally last, on the review screen). Any
   * later change to the answers, readings, photos or batteries clears the
   * signature, so what was signed is what is completed.
   */
  async sign(visitId: string, input: unknown, caller: AuthUser) {
    const data = parseInput(SignatureInput, input);
    const svg = signatureSvg(data.width, data.height, data.strokes);
    const key = `pm/visits/${visitId}/signature-${randomUUID()}.svg`;
    const previous = await this.prisma.$transaction(async (tx) => {
      const visit = await this.requireOwnEditable(tx, visitId, caller);
      await this.storage.put(key, Buffer.from(svg, 'utf8'), 'image/svg+xml');
      await tx.pmVisit.update({ where: { id: visitId }, data: { signatureKey: key, signedAt: new Date(), signedName: data.name ?? caller.fullName, updatedById: caller.id } });
      return visit.signatureKey;
    });
    if (previous) await this.storage.delete(previous).catch((err: unknown) => this.logger.error({ err, key: previous }, 'Could not remove a replaced signature'));
    return this.get(visitId, caller);
  }

  /** The signature image, if the caller may see the visit. */
  async signatureFile(visitId: string, caller: AuthUser) {
    const scope = siteScope(caller);
    const visit = await this.prisma.pmVisit.findFirst({ where: within<Prisma.PmVisitWhereInput>(scope ? { site: scope } : undefined, { id: visitId }), select: { signatureKey: true } });
    if (!visit?.signatureKey) throw notFound('Signature');
    return this.storage.get(visit.signatureKey);
  }

  private async signatureIssue(visit: Pick<PmVisit, 'id' | 'signedAt'>) {
    if (visit.signedAt || !(await this.settings.get('pm')).requireSignature) return [];
    return [{ sectionCode: '', kind: 'SIGNATURE_REQUIRED' as const, refType: 'visit' as const, refId: visit.id, label: 'Technician signature' }];
  }

  /** A change after signing makes the signature out of date. */
  private async clearSignature(tx: Tx, visit: PmVisit) {
    if (!visit.signatureKey) return;
    await tx.pmVisit.update({ where: { id: visit.id }, data: { signatureKey: null, signedAt: null, signedName: null } });
    const key = visit.signatureKey;
    setImmediate(() => void this.storage.delete(key).catch((err: unknown) => this.logger.error({ err, key }, 'Could not remove an outdated signature')));
  }

  // --- Battery units --------------------------------------------------------------------

  /**
   * Records each battery's voltage at a site whose battery count is
   * configured. A unit without a voltage clears it; an edit older than the
   * stored one (clientUpdatedAt) is skipped. No limits beyond storage bounds:
   * none are configured for individual batteries.
   */
  async saveBatteryUnits(visitId: string, input: unknown, caller: AuthUser) {
    const data = parseInput(BatteryUnitsInput, input);
    const skipped = await this.prisma
      .$transaction(async (tx) => {
        const visit = await this.requireOwnEditable(tx, visitId, caller);
        const requirement = await batteryUnitRequirement(tx, visit);
        if (!requirement) throw invalid('BATTERY_UNITS_NOT_CONFIGURED', 'This site has no battery count configured, so batteries are not recorded one by one.');
        if (stringList(visit.notApplicableSections).includes(requirement.sectionCode)) {
          throw invalid('SECTION_NOT_APPLICABLE', 'The battery section is marked not applicable for this visit.');
        }
        const problems = data.units.flatMap((u, i) =>
          u.unitNumber > requirement.count ? [{ path: `units.${i}.unitNumber`, message: `this site has ${requirement.count} batteries` }] : [],
        );
        if (problems.length) throw invalid('VALIDATION_FAILED', 'Some values are not valid. Nothing was saved.', problems);
        const skipped: number[] = [];
        for (const u of data.units) {
          const key = { visitId_unitNumber: { visitId, unitNumber: u.unitNumber } };
          const stored = await tx.batteryUnitReading.findUnique({ where: key });
          const at = u.clientUpdatedAt ? new Date(u.clientUpdatedAt) : null;
          if (stored?.clientUpdatedAt && at && at < stored.clientUpdatedAt) {
            skipped.push(u.unitNumber);
            continue;
          }
          if (u.voltageV == null) {
            if (stored) await tx.batteryUnitReading.delete({ where: key });
            continue;
          }
          const values = { voltageV: u.voltageV, comment: u.comment ?? null, recordedAt: new Date(), clientUpdatedAt: at };
          await tx.batteryUnitReading.upsert({ where: key, create: { visitId, unitNumber: u.unitNumber, siteId: visit.siteId, ...values }, update: values });
        }
        await this.clearSignature(tx, visit);
        await tx.pmVisit.update({ where: { id: visitId }, data: { updatedById: caller.id } });
        await this.refreshProgress(tx, visit);
        return skipped;
      })
      .catch(rethrowDbError);
    return { ...(await this.get(visitId, caller)), skippedBatteryUnits: skipped };
  }

  // --- Photos ----------------------------------------------------------------------------

  async addPhoto(visitId: string, file: UploadedFile | undefined, fields: unknown, caller: AuthUser) {
    const data = parseInput(PhotoFields, fields ?? {});
    if (!file || file.size === 0) throw invalid('FILE_REQUIRED', 'Attach the photo as the "file" field.');
    if (file.size > this.config.photoMaxBytes) {
      throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', `A photo can be at most ${Math.floor(this.config.photoMaxBytes / 1_000_000)} MB.`);
    }
    const type = sniffImage(file.buffer);
    if (!type) throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_MEDIA_TYPE', 'Photos must be JPEG, PNG or WebP images.');

    // Checks first (no file is written for a request that will be refused).
    const visit = await this.prisma.$transaction(async (tx) => {
      const v = await this.requireOwnEditable(tx, visitId, caller);
      await this.clearSignature(tx, v);
      return v;
    });
    if (data.id) {
      const existing = await this.prisma.pmPhoto.findUnique({ where: { id: data.id }, omit: { storageKey: true } });
      if (existing) {
        if (existing.visitId !== visitId) throw new AppError(HttpStatus.CONFLICT, 'ID_CONFLICT', 'A different photo already uses this id.');
        return existing; // a retried upload
      }
    }
    if (data.checklistItemId) {
      const item = await this.prisma.pmChecklistItem.findFirst({ where: { id: data.checklistItemId, section: { templateId: visit.templateId } } });
      if (!item) throw invalid('INVALID_REFERENCE', 'The question is not part of this visit’s template.');
    }

    const id = data.id ?? randomUUID();
    const storageKey = `pm/visits/${visitId}/${id}.${type.ext}`;
    await this.storage.put(storageKey, file.buffer, type.contentType);
    try {
      return await this.prisma.pmPhoto.create({
        data: {
          id,
          visitId,
          checklistItemId: data.checklistItemId ?? null,
          storageKey,
          contentType: type.contentType,
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          caption: data.caption ?? null,
          takenAt: data.takenAt ? new Date(data.takenAt) : null,
          uploadedById: caller.id,
        },
        omit: { storageKey: true },
      });
    } catch (e) {
      await this.storage.delete(storageKey).catch((err: unknown) => this.logger.error({ err, storageKey }, 'Could not remove an orphaned photo file'));
      return rethrowDbError(e);
    }
  }

  /** The photo file, if the caller may see the visit. */
  async photoFile(visitId: string, photoId: string, caller: AuthUser) {
    const scope = siteScope(caller);
    const photo = await this.prisma.pmPhoto.findFirst({
      where: { id: photoId, visitId, visit: within<Prisma.PmVisitWhereInput>(scope ? { site: scope } : undefined, {}) },
    });
    if (!photo) throw notFound('Photo');
    return { data: await this.storage.get(photo.storageKey), contentType: photo.contentType };
  }

  async deletePhoto(visitId: string, photoId: string, caller: AuthUser) {
    const key = await this.prisma.$transaction(async (tx) => {
      const visit = await this.requireOwnEditable(tx, visitId, caller);
      const photo = await tx.pmPhoto.findFirst({ where: { id: photoId, visitId } });
      if (photo) await this.clearSignature(tx, visit);
      if (!photo) throw notFound('Photo');
      await tx.pmPhoto.delete({ where: { id: photoId } });
      return photo.storageKey;
    });
    await this.storage.delete(key).catch((err: unknown) => this.logger.error({ err, key }, 'Could not remove a deleted photo file'));
  }

  // --- Helpers -------------------------------------------------------------------------

  /** The technician must be actively assigned to the site to work there. */
  private async requireAssigned(tx: Tx, siteId: string, userId: string) {
    const assigned = await tx.siteAssignment.count({ where: { siteId, userId, role: 'TECHNICIAN', active: true } });
    if (!assigned) throw new AppError(HttpStatus.FORBIDDEN, 'NOT_ASSIGNED', 'You are not assigned to this site.');
  }

  /** Locks the visit; it must be the caller's and still editable. */
  private async requireOwnEditable(tx: Tx, visitId: string, caller: AuthUser): Promise<PmVisit> {
    await tx.$queryRaw`SELECT id FROM pm_visits WHERE id = ${visitId} FOR UPDATE`;
    const visit = await tx.pmVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw notFound('Visit');
    if (visit.technicianId !== caller.id) {
      const scope = siteScope(caller);
      const visible = await tx.pmVisit.count({ where: within<Prisma.PmVisitWhereInput>(scope ? { site: scope } : undefined, { id: visitId }) });
      if (!visible) throw notFound('Visit');
      throw new AppError(HttpStatus.FORBIDDEN, 'NOT_YOUR_VISIT', 'Only the technician carrying out this PM can change it.');
    }
    if (!EDITABLE.includes(visit.status)) throw new AppError(HttpStatus.CONFLICT, 'VISIT_LOCKED', `This PM is ${visit.status.toLowerCase().replace('_', ' ')} and can no longer be changed.`);
    return visit;
  }

  private refreshProgress(tx: Tx, visit: PmVisit) {
    return refreshProgress(tx, visit);
  }
}

/** Draws the strokes as a plain SVG (paths only; coordinates rounded to 0.1). */
export function signatureSvg(width: number, height: number, strokes: [number, number][][]): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  const d = strokes
    .map((s) => (s.length === 1 ? `M${r(s[0]![0])} ${r(s[0]![1])}l0.1 0` : s.map(([x, y], i) => `${i ? 'L' : 'M'}${r(x)} ${r(y)}`).join('')))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><path d="${d}" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

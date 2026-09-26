/**
 * Offline PM work as data (pure; unit-tested in Node).
 *
 * The phone keeps, per visit, the last copy the server sent (the "base") and
 * the changes not yet accepted by the server (the outbox). What the
 * technician sees is the base with those changes applied, judged by the same
 * PM engine the server runs (completion %, failures, what blocks completion).
 * When the server answers, its copy becomes the new base and the remaining
 * changes are applied on top again, so nothing entered on the phone is lost.
 */
import { evaluateGeofence, pmEngine } from '@ipt/shared';
import type { FieldPack, Photo, ResponseRow, Schedule, Section, Site, Template, VisitDetail, VisitIssue } from '../lib/api/types';

export type SyncStatus = 'LOCAL' | 'PENDING_SYNC' | 'SYNCING' | 'SYNCED' | 'SYNC_ERROR';
export type OpStatus = 'PENDING_SYNC' | 'SYNCING' | 'SYNC_ERROR';

export interface StartPayload {
  id: string;
  scheduleId?: string;
  siteId?: string;
  clientCreatedAt: string;
  gps?: { latitude: number; longitude: number; accuracyM?: number; capturedAt?: string };
  outsideRadiusReason?: string;
}

export interface ResponseChange {
  checklistItemId: string;
  answer: ResponseRow['answer'];
  numericValue: number | null;
  textValue: string | null;
  selectedOptions: string[] | null;
  dateValue: string | null;
  datetimeValue: string | null;
  comment: string | null;
  clientUpdatedAt: string;
}

export interface ReadingChange {
  readingFieldId: string;
  numericValue: number | null;
  textValue: string | null;
  clientUpdatedAt: string;
}

export interface AnswersPayload {
  responses: ResponseChange[];
  readings: ReadingChange[];
  notApplicableSections?: string[];
  overallComments?: string | null;
}

export interface BatteryPayload {
  units: { unitNumber: number; voltageV: number | null; comment?: string | null; clientUpdatedAt: string }[];
}

export interface PhotoPayload {
  id: string;
  localUri: string;
  checklistItemId: string | null;
  caption?: string;
  takenAt: string;
}

export interface SignPayload {
  width: number;
  height: number;
  strokes: [number, number][][];
  name?: string;
}

export type OpInput =
  | { kind: 'start'; payload: StartPayload }
  | { kind: 'answers'; payload: AnswersPayload }
  | { kind: 'battery'; payload: BatteryPayload }
  | { kind: 'photo'; payload: PhotoPayload }
  | { kind: 'photo_delete'; payload: { photoId: string } }
  | { kind: 'sign'; payload: SignPayload }
  | { kind: 'complete'; payload: Record<string, never> };

export type Op = OpInput & {
  seq: number;
  visitId: string;
  status: OpStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  /** When the technician made the change (ISO). */
  createdAt: string;
};

// --- Coalescing -----------------------------------------------------------------------

/**
 * Joins a new change into the last queued one when both are the same kind of
 * edit (answers, or battery voltages), so a burst of edits is sent as one
 * request. Only the last queued change is joined: order is kept, so an edit
 * made after signing still removes the signature, as on the server.
 */
export function mergeInto(tail: OpInput, next: OpInput): OpInput | null {
  if (tail.kind === 'answers' && next.kind === 'answers') {
    const a = tail.payload;
    const b = next.payload;
    const responses = new Map(a.responses.map((r) => [r.checklistItemId, r]));
    for (const r of b.responses) responses.set(r.checklistItemId, r);
    const readings = new Map(a.readings.map((r) => [r.readingFieldId, r]));
    for (const r of b.readings) readings.set(r.readingFieldId, r);
    return {
      kind: 'answers',
      payload: {
        responses: [...responses.values()],
        readings: [...readings.values()],
        ...(b.notApplicableSections ? { notApplicableSections: b.notApplicableSections } : a.notApplicableSections ? { notApplicableSections: a.notApplicableSections } : {}),
        ...(b.overallComments !== undefined ? { overallComments: b.overallComments } : a.overallComments !== undefined ? { overallComments: a.overallComments } : {}),
      },
    };
  }
  if (tail.kind === 'battery' && next.kind === 'battery') {
    const units = new Map(tail.payload.units.map((u) => [u.unitNumber, u]));
    for (const u of next.payload.units) units.set(u.unitNumber, u);
    return { kind: 'battery', payload: { units: [...units.values()].sort((x, y) => x.unitNumber - y.unitNumber) } };
  }
  return null;
}

// --- Applying changes to a visit ---------------------------------------------------------

const EDITABLE = new Set(['IN_PROGRESS', 'REJECTED']);
export const isEditable = (v: Pick<VisitDetail, 'status'>) => EDITABLE.has(v.status);

function engineItems(v: VisitDetail) {
  return v.sections.flatMap((s) => s.items.map((i) => ({ ...i, sectionId: s.id })));
}
function engineFields(v: VisitDetail) {
  return v.sections.flatMap((s) => s.readingFields.map((f) => ({ ...f, sectionId: s.id })));
}

/** An edit after signing makes the signature out of date (as on the server). */
const unsign = (v: VisitDetail): VisitDetail => (v.signature ? { ...v, signature: null } : v);
const reopen = (v: VisitDetail): VisitDetail => (v.status === 'REJECTED' ? { ...v, status: 'IN_PROGRESS' } : v);

/**
 * Applies one queued change the way the server will. Values the engine
 * refuses are left out (the phone checks them before queueing, so this only
 * guards against a template that changed underneath).
 */
export function applyOp(v: VisitDetail, op: Op): VisitDetail {
  switch (op.kind) {
    case 'start':
      return v;
    case 'answers': {
      const items = new Map(engineItems(v).map((i) => [i.id, i]));
      const fields = new Map(engineFields(v).map((f) => [f.id, f]));
      const responses = new Map(v.responses.map((r) => [r.checklistItemId, r]));
      for (const r of op.payload.responses) {
        const item = items.get(r.checklistItemId);
        if (!item) continue;
        const res = pmEngine.normalizeResponse(item, r);
        if (!res.ok) continue;
        if (pmEngine.isEmptyResponse(res.value)) responses.delete(item.id);
        else responses.set(item.id, { ...responses.get(item.id), checklistItemId: item.id, ...res.value, isFailure: pmEngine.isFailure(item, res.value.answer) });
      }
      const readings = new Map(v.readings.map((r) => [r.readingFieldId, r]));
      for (const r of op.payload.readings) {
        const field = fields.get(r.readingFieldId);
        if (!field) continue;
        const res = pmEngine.normalizeReading(field, r);
        if (!res.ok) continue;
        if (res.value.numericValue == null && res.value.textValue == null) readings.delete(field.id);
        else readings.set(field.id, { ...readings.get(field.id), readingFieldId: field.id, ...res.value });
      }
      return reopen(
        unsign({
          ...v,
          responses: [...responses.values()],
          readings: [...readings.values()],
          ...(op.payload.notApplicableSections ? { notApplicableSections: [...new Set(op.payload.notApplicableSections)] } : {}),
          ...(op.payload.overallComments !== undefined ? { overallComments: op.payload.overallComments?.trim() || null } : {}),
        }),
      );
    }
    case 'battery': {
      const units = new Map((v.modules.battery?.units ?? []).map((u) => [u.unitNumber, u]));
      for (const u of op.payload.units) {
        if (u.voltageV == null) units.delete(u.unitNumber);
        else units.set(u.unitNumber, { unitNumber: u.unitNumber, voltageV: u.voltageV, comment: u.comment ?? null });
      }
      const list = [...units.values()].sort((a, b) => a.unitNumber - b.unitNumber);
      return unsign({ ...v, modules: { ...v.modules, battery: { ...(v.modules.battery ?? {}), units: list } } });
    }
    case 'photo': {
      if (v.photos.some((p) => p.id === op.payload.id)) return unsign(v);
      const photo: Photo = {
        id: op.payload.id,
        checklistItemId: op.payload.checklistItemId,
        caption: op.payload.caption ?? null,
        contentType: 'image/jpeg',
        createdAt: op.createdAt,
        localUri: op.payload.localUri,
      };
      return unsign({ ...v, photos: [...v.photos, photo] });
    }
    case 'photo_delete':
      return unsign({ ...v, photos: v.photos.filter((p) => p.id !== op.payload.photoId) });
    case 'sign':
      return { ...v, signature: { signedAt: op.createdAt, signedName: op.payload.name ?? null } };
    case 'complete':
      return isEditable(v) ? { ...v, status: 'COMPLETED', completedAt: op.createdAt } : v;
  }
}

/** Completion %, failures and what blocks completion, by the PM engine. */
export function judge(v: VisitDetail): VisitDetail {
  const byItem = new Map(engineItems(v).map((i) => [i.id, i]));
  const state: pmEngine.VisitState = {
    sections: v.sections.map((s) => ({ id: s.id, code: s.code, name: s.name, sortOrder: s.sortOrder, isActive: s.isActive, allowNotApplicable: s.allowNotApplicable })),
    items: [...byItem.values()],
    fields: engineFields(v),
    rules: v.engine.rules,
    responses: new Map(v.responses.map((r) => [r.checklistItemId, r])),
    readings: new Map(v.readings.map((r) => [r.readingFieldId, r])),
    photoCounts: v.photos.reduce((m, p) => (p.checklistItemId ? m.set(p.checklistItemId, (m.get(p.checklistItemId) ?? 0) + 1) : m), new Map<string, number>()),
    notApplicableSections: v.notApplicableSections,
    extraRequired: v.engine.batteryUnits
      ? Array.from({ length: v.engine.batteryUnits.count }, (_, i) => ({
          sectionCode: v.engine.batteryUnits!.sectionCode,
          refId: String(i + 1),
          label: `Battery ${i + 1} voltage`,
          done: (v.modules.battery?.units ?? []).some((u) => u.unitNumber === i + 1),
        }))
      : [],
  };
  const progress = pmEngine.visitProgress(state);
  const signature: VisitIssue[] =
    v.engine.requireSignature && !v.signature ? [{ sectionCode: '', kind: 'SIGNATURE_REQUIRED', refType: 'visit', refId: v.id, label: 'Technician signature' }] : [];
  return {
    ...v,
    completionPct: progress.completionPct,
    failureCount: progress.failureCount,
    progress,
    issues: isEditable(v) ? [...pmEngine.visitIssues(state), ...signature] : [],
  };
}

/** The visit as the technician sees it: the base with every queued change applied. */
export function currentVisit(base: VisitDetail, ops: readonly Op[]): VisitDetail {
  return judge(ops.reduce(applyOp, base));
}

/** A visit's sync state from its queued changes. */
export function visitSyncStatus(fromServer: boolean, ops: readonly Pick<Op, 'status'>[]): SyncStatus {
  if (ops.some((o) => o.status === 'SYNC_ERROR')) return 'SYNC_ERROR';
  if (ops.some((o) => o.status === 'SYNCING')) return 'SYNCING';
  if (ops.length) return fromServer ? 'PENDING_SYNC' : 'LOCAL';
  return 'SYNCED';
}

// --- Checking a change before it is queued -------------------------------------------------

/** The engine's objection to an answer, or null. */
export function responseProblem(v: VisitDetail, change: ResponseChange): string | null {
  const item = engineItems(v).find((i) => i.id === change.checklistItemId);
  if (!item) return 'This question is not part of the PM.';
  const res = pmEngine.normalizeResponse(item, change);
  return res.ok ? null : res.error;
}

export function readingProblem(v: VisitDetail, change: ReadingChange): string | null {
  const field = engineFields(v).find((f) => f.id === change.readingFieldId);
  if (!field) return 'This reading is not part of the PM.';
  const res = pmEngine.normalizeReading(field, change);
  return res.ok ? null : res.error;
}

// --- Starting a visit on the phone --------------------------------------------------------

const EQUIPMENT: Record<NonNullable<Section['requiresEquipment']>, 'generatorAvailable' | 'solarAvailable' | 'gridAvailable'> = {
  GENERATOR: 'generatorAvailable',
  SOLAR: 'solarAvailable',
  GRID: 'gridAvailable',
};

export type LocalStartResult = { ok: true; visit: VisitDetail } | { ok: false; code: string; message: string };

/**
 * The visit as the server will create it, built from the field pack so work
 * can begin without a connection. The same checks as the server are applied
 * with the pack's data (the server checks again when the start is sent).
 */
export function startVisitLocally(
  pack: Pick<FieldPack, 'sites' | 'schedules' | 'templates' | 'rules' | 'settings'>,
  input: StartPayload & { technicianId: string },
): LocalStartResult {
  let schedule: Schedule | undefined;
  let site: Site | undefined;
  let template: Template | undefined;
  if (input.scheduleId) {
    schedule = pack.schedules.find((s) => s.id === input.scheduleId);
    if (!schedule) return { ok: false, code: 'NOT_IN_PACK', message: 'This PM is not in the data saved on the phone. Connect to start it.' };
    if (schedule.status !== 'SCHEDULED' && schedule.status !== 'OVERDUE') return { ok: false, code: 'SCHEDULE_NOT_OPEN', message: 'This PM is not open.' };
    site = pack.sites.find((s) => s.id === schedule!.siteId);
    template = pack.templates.find((t) => t.id === schedule!.template.id);
    if (!template) return { ok: false, code: 'NOT_IN_PACK', message: 'This PM uses a checklist version not saved on the phone. Connect to start it.' };
  } else {
    site = pack.sites.find((s) => s.id === input.siteId);
    const active = pack.templates.filter((t) => t.status === 'ACTIVE');
    if (active.length !== 1) {
      return active.length
        ? { ok: false, code: 'TEMPLATE_REQUIRED', message: 'Several checklists are active. Connect to start an unscheduled PM.' }
        : { ok: false, code: 'NO_ACTIVE_TEMPLATE', message: 'There is no active PM checklist saved on the phone. Connect to update it.' };
    }
    template = active[0];
  }
  if (!site || !template) return { ok: false, code: 'NOT_ASSIGNED', message: 'You are not assigned to this site.' };
  if (site.status !== 'ACTIVE') return { ok: false, code: 'SITE_NOT_ACTIVE', message: 'PM can only be started at an active site.' };

  const geo = evaluateGeofence({
    site: { latitude: site.latitude == null ? null : Number(site.latitude), longitude: site.longitude == null ? null : Number(site.longitude), geofenceRadiusM: site.geofenceRadiusM },
    defaultRadiusM: pack.settings.geofence.radiusM,
    mode: pack.settings.geofence.mode,
    position: input.gps ?? null,
  });
  if (geo.blocked) return { ok: false, code: 'OUTSIDE_GEOFENCE', message: `PM can only be started within ${geo.radiusM} m of the site.` };
  if (geo.reasonRequired && !input.outsideRadiusReason) return { ok: false, code: 'REASON_REQUIRED', message: 'Give the reason for starting PM here.' };

  const sections = template.sections
    .filter((s) => s.isActive)
    .map((s) => ({ ...s, items: s.items.filter((i) => i.isActive), readingFields: s.readingFields.filter((f) => f.isActive) }));
  const battery = sections.filter((s) => s.category === 'BATTERY').sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const visit: VisitDetail = {
    id: input.id,
    status: 'IN_PROGRESS',
    startedAt: input.clientCreatedAt,
    completedAt: null,
    completionPct: 0,
    failureCount: 0,
    notApplicableSections: sections.filter((s) => s.allowNotApplicable && s.requiresEquipment && !site![EQUIPMENT[s.requiresEquipment]]).map((s) => s.code),
    overallComments: null,
    reviewComments: null,
    technicianId: input.technicianId,
    siteId: site.id,
    templateId: template.id,
    scheduleId: schedule?.id ?? null,
    gpsStatus: geo.status,
    gpsDistanceM: geo.distanceM,
    gpsRadiusM: geo.radiusM,
    site: { id: site.id, siteCode: site.siteCode, siteName: site.siteName },
    template: { name: template.name, version: template.version },
    sections,
    responses: [],
    readings: [],
    photos: [],
    progress: { completionPct: 0, failureCount: 0, sections: [] },
    issues: [],
    signature: null,
    modules: { battery: site.batteryUnitCount && battery ? { units: [] } : null, dc: null },
    engine: {
      rules: pack.rules,
      batteryUnits: site.batteryUnitCount && battery ? { count: site.batteryUnitCount, sectionCode: battery.code } : null,
      requireSignature: pack.settings.pm.requireSignature,
    },
  };
  return { ok: true, visit: judge(visit) };
}

// --- Retrying --------------------------------------------------------------------------

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60_000;

/** Exponential back-off with ±20% jitter: 5 s, 10 s, 20 s … at most 15 min. */
export function retryDelayMs(attempts: number, random: () => number = Math.random): number {
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(delay * (0.8 + 0.4 * random()));
}

import { describe, expect, it } from 'vitest';
import { PACK, SITE, USER } from './test-fixtures';
import { currentVisit, mergeInto, retryDelayMs, startVisitLocally, visitSyncStatus, type Op, type OpInput, type ResponseChange } from './visit-ops';

const T0 = '2026-09-20T08:00:00.000Z';
const start = (extra: Record<string, unknown> = {}) => {
  const r = startVisitLocally(PACK, { id: 'v-1', siteId: SITE.id, clientCreatedAt: T0, technicianId: USER, ...extra });
  if (!r.ok) throw new Error(r.message);
  return r.visit;
};
let seq = 0;
const op = (input: OpInput, at = T0): Op => ({ ...input, seq: ++seq, visitId: 'v-1', status: 'PENDING_SYNC', attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: at });
const answer = (checklistItemId: string, a: 'YES' | 'NO' | 'NA' | null, comment: string | null = null): ResponseChange => ({
  checklistItemId,
  answer: a,
  numericValue: null,
  textValue: null,
  selectedOptions: null,
  dateValue: null,
  datetimeValue: null,
  comment,
  clientUpdatedAt: T0,
});

describe('starting a visit on the phone', () => {
  it('builds the visit as the server would: equipment sections N/A, batteries required, signature required', () => {
    const v = start();
    expect(v).toMatchObject({ id: 'v-1', status: 'IN_PROGRESS', siteId: SITE.id, templateId: 't-1', notApplicableSections: ['GENERATOR'], gpsStatus: 'UNAVAILABLE' });
    expect(v.engine).toEqual({ rules: PACK.rules, batteryUnits: { count: 2, sectionCode: 'BATTERY' }, requireSignature: true });
    // Required: DC question + DC voltage + 2 batteries (generator is N/A).
    expect(v.progress.sections.find((s) => s.code === 'DC')).toMatchObject({ required: 2, done: 0 });
    expect(v.progress.sections.find((s) => s.code === 'BATTERY')).toMatchObject({ required: 2, done: 0 });
    expect(v.issues.map((i) => i.kind)).toEqual(['REQUIRED', 'REQUIRED', 'REQUIRED', 'REQUIRED', 'SIGNATURE_REQUIRED']);
  });

  it('applies the geofence settings saved on the phone', () => {
    const far = { latitude: 7.01, longitude: -11 };
    const block = { ...PACK, settings: { ...PACK.settings, geofence: { mode: 'BLOCK' as const, radiusM: 100 } } };
    expect(startVisitLocally(block, { id: 'v', siteId: SITE.id, clientCreatedAt: T0, technicianId: USER, gps: far })).toMatchObject({ ok: false, code: 'OUTSIDE_GEOFENCE' });
    const reason = { ...PACK, settings: { ...PACK.settings, geofence: { mode: 'REQUIRE_REASON' as const, radiusM: 100 } } };
    expect(startVisitLocally(reason, { id: 'v', siteId: SITE.id, clientCreatedAt: T0, technicianId: USER, gps: far })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(startVisitLocally(reason, { id: 'v', siteId: SITE.id, clientCreatedAt: T0, technicianId: USER, gps: far, outsideRadiusReason: 'Flooded road' })).toMatchObject({ ok: true });
  });

  it('refuses what the phone cannot start offline', () => {
    expect(startVisitLocally(PACK, { id: 'v', siteId: 'other', clientCreatedAt: T0, technicianId: USER })).toMatchObject({ ok: false, code: 'NOT_ASSIGNED' });
    expect(startVisitLocally(PACK, { id: 'v', scheduleId: 'unknown', clientCreatedAt: T0, technicianId: USER })).toMatchObject({ ok: false, code: 'NOT_IN_PACK' });
    expect(startVisitLocally(PACK, { id: 'v', scheduleId: 'sch-1', clientCreatedAt: T0, technicianId: USER })).toMatchObject({ ok: true, visit: { scheduleId: 'sch-1' } });
  });
});

describe('changes applied to a visit (engine rules, offline)', () => {
  it('computes progress, failures and what blocks completion', () => {
    const base = start();
    const v = currentVisit(base, [
      op({ kind: 'answers', payload: { responses: [answer('i-clean', 'NO')], readings: [{ readingFieldId: 'f-volt', numericValue: 52.99, textValue: null, clientUpdatedAt: T0 }] } }),
      op({ kind: 'battery', payload: { units: [{ unitNumber: 1, voltageV: 13.1, clientUpdatedAt: T0 }] } }),
    ]);
    expect(v.completionPct).toBe(75); // 3 of 4 required
    expect(v.failureCount).toBe(1);
    expect(v.responses[0]).toMatchObject({ answer: 'NO', isFailure: true });
    expect(v.issues.map((i) => `${i.kind}:${i.refId}`)).toEqual(['COMMENT_REQUIRED:i-clean', 'PHOTO_REQUIRED:i-clean', 'REQUIRED:2', 'SIGNATURE_REQUIRED:v-1']);
  });

  it('checks consistency rules and ignores values the engine refuses', () => {
    const v = currentVisit(start(), [
      op({
        kind: 'answers',
        payload: {
          responses: [{ ...answer('i-clean', null), numericValue: 5 }], // a Yes/No question takes no number
          readings: [
            { readingFieldId: 'f-volt', numericValue: 50, textValue: null, clientUpdatedAt: T0 },
            { readingFieldId: 'f-min', numericValue: 51, textValue: null, clientUpdatedAt: T0 },
          ],
        },
      }),
    ]);
    expect(v.responses).toEqual([]);
    expect(v.issues.some((i) => i.kind === 'INCONSISTENT' && i.label === 'Minimum above voltage')).toBe(true);
  });

  it('a change after signing removes the signature; completing locks the visit', () => {
    const signed = currentVisit(start(), [op({ kind: 'sign', payload: { width: 100, height: 100, strokes: [[[1, 1], [2, 2]]], name: 'Abraham Cole' } }, '2026-09-20T09:00:00.000Z')]);
    expect(signed.signature).toEqual({ signedAt: '2026-09-20T09:00:00.000Z', signedName: 'Abraham Cole' });
    expect(signed.issues.some((i) => i.kind === 'SIGNATURE_REQUIRED')).toBe(false);
    const edited = currentVisit(signed, [op({ kind: 'photo', payload: { id: 'p-1', localUri: 'file:///p-1.jpg', checklistItemId: 'i-clean', takenAt: T0 } })]);
    expect(edited.signature).toBeNull();
    expect(edited.photos).toMatchObject([{ id: 'p-1', localUri: 'file:///p-1.jpg' }]);
    const done = currentVisit(start(), [op({ kind: 'complete', payload: {} })]);
    expect(done.status).toBe('COMPLETED');
    expect(done.issues).toEqual([]);
  });

  it('N/A sections and overall comments', () => {
    const v = currentVisit(start(), [op({ kind: 'answers', payload: { responses: [], readings: [], notApplicableSections: ['GENERATOR', 'BATTERY'], overallComments: '  All good ' } })]);
    expect(v.notApplicableSections).toEqual(['GENERATOR', 'BATTERY']);
    expect(v.overallComments).toBe('All good');
    expect(v.issues.some((i) => i.refType === 'battery_unit')).toBe(false);
  });
});

describe('outbox helpers', () => {
  it('joins bursts of the same kind of edit, latest value per question', () => {
    const a: OpInput = { kind: 'answers', payload: { responses: [answer('i-clean', 'NO')], readings: [], notApplicableSections: ['GENERATOR'] } };
    const b: OpInput = { kind: 'answers', payload: { responses: [answer('i-clean', 'YES'), answer('i-oil', 'YES')], readings: [], overallComments: 'x' } };
    expect(mergeInto(a, b)).toEqual({
      kind: 'answers',
      payload: { responses: [answer('i-clean', 'YES'), answer('i-oil', 'YES')], readings: [], notApplicableSections: ['GENERATOR'], overallComments: 'x' },
    });
    expect(mergeInto(a, { kind: 'complete', payload: {} })).toBeNull();
  });

  it('sync status and back-off', () => {
    expect(visitSyncStatus(false, [{ status: 'PENDING_SYNC' }])).toBe('LOCAL');
    expect(visitSyncStatus(true, [{ status: 'PENDING_SYNC' }])).toBe('PENDING_SYNC');
    expect(visitSyncStatus(true, [{ status: 'SYNCING' }])).toBe('SYNCING');
    expect(visitSyncStatus(true, [{ status: 'PENDING_SYNC' }, { status: 'SYNC_ERROR' }])).toBe('SYNC_ERROR');
    expect(visitSyncStatus(true, [])).toBe('SYNCED');
    const mid = () => 0.5;
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n, mid))).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(retryDelayMs(30, mid)).toBe(15 * 60_000);
  });
});

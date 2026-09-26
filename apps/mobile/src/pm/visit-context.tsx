import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChecklistItem, ReadingField, ReadingRow, ResponsePatch, ResponseRow, VisitDetail } from '@/lib/api/types';
import { errorMessage } from '@/lib/api/errors';
import { ApiError } from '@/lib/api/session-client';
import { useOffline } from '@/offline/offline-provider';
import { deletePhotoFile } from '@/offline/runtime';
import type { StoredOp, VisitView } from '@/offline/store';
import { applyOp, isEditable, judge, readingProblem, responseProblem, type OpInput, type ReadingChange, type SyncStatus } from '@/offline/visit-ops';
import { applyPatch, completionMessage, readingBody, responseBody } from './model';

export interface VisitModel {
  visit: VisitDetail | null;
  loading: boolean;
  error: string | null;
  responses: Map<string, ResponseRow>;
  readings: Map<string, ReadingRow>;
  editable: boolean;
  /** LOCAL (only on this phone), PENDING_SYNC, SYNCING, SYNCED or SYNC_ERROR. */
  syncStatus: SyncStatus;
  /** The change the server refused, when there is one. */
  syncError: { message: string; kind: StoredOp['kind'] } | null;
  /** Newer values from another device were kept by the server. */
  notice: string | null;
  saveError: string | null;
  /** Problems with one answer or reading, by its id (checked on the phone, or refused by the server). */
  fieldErrors: Map<string, string>;
  setResponse: (item: ChecklistItem, patch: ResponsePatch) => void;
  setReading: (field: ReadingField, value: number | string | null) => void;
  setNotApplicable: (sectionCode: string, notApplicable: boolean) => Promise<void>;
  saveOverallComments: (text: string) => Promise<string | null>;
  addPhoto: (photo: { id: string; uri: string; checklistItemId: string | null; caption?: string; takenAt: string }) => Promise<string | null>;
  deletePhoto: (photoId: string) => Promise<string | null>;
  saveBatteryUnits: (units: { unitNumber: number; voltageV: number | null; comment?: string | null }[]) => Promise<string | null>;
  sign: (sig: { width: number; height: number; strokes: [number, number][][]; name?: string }) => Promise<string | null>;
  complete: () => Promise<{ ok: true } | { ok: false; message: string }>;
  reload: () => Promise<void>;
  retrySync: () => Promise<void>;
  /** Drops the refused change (dropping a refused start drops the visit). */
  discardRefused: () => Promise<{ visitRemoved: boolean }>;
  dismissNotice: () => Promise<void>;
}

const Ctx = createContext<VisitModel | null>(null);

/** Server problems with an answers batch, mapped back to the question or reading ("responses.3" → its id). */
function refusedFields(op: StoredOp | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (op?.kind !== 'answers' || !Array.isArray(op.lastErrorDetails)) return out;
  for (const d of op.lastErrorDetails as { path?: string; message?: string }[]) {
    const [kind, index] = (d.path ?? '').split('.');
    const id = kind === 'responses' ? op.payload.responses[Number(index)]?.checklistItemId : kind === 'readings' ? op.payload.readings[Number(index)]?.readingFieldId : undefined;
    if (id && d.message) out.set(id, d.message);
  }
  return out;
}

/**
 * One visit, from the phone's offline store. Every change is shown at once,
 * saved on the phone and queued for the server; the sync engine sends it when
 * there is a connection. Progress and what blocks completion are worked out on
 * the phone with the server's engine rules.
 */
export function VisitProvider({ visitId, children }: { visitId: string; children: ReactNode }) {
  const { store, engine, requestSync } = useOffline();
  const [view, setView] = useState<VisitView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<Map<string, string>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);
  // Edits being written: a copy read meanwhile could miss them, so it waits.
  const writing = useRef(0);

  const readStore = useCallback(async () => {
    if (!store) return;
    const v = await store.visit(visitId);
    if (v) {
      setView(v);
      setError(null);
    }
    return v;
  }, [store, visitId]);

  const load = useCallback(async () => {
    if (!store || !engine) return;
    try {
      const saved = await readStore();
      if (!saved || saved.fromServer) {
        // Fresh from the server when there is a connection; the queued changes stay on top.
        await engine.refreshVisit(visitId).catch((e: unknown) => {
          if (!saved) throw e;
        });
        await readStore();
      }
    } catch (e) {
      setError(e instanceof ApiError && e.offline ? 'This PM is not saved on this phone. Connect to open it.' : errorMessage(e, 'open this PM'));
    } finally {
      setLoading(false);
    }
  }, [store, engine, visitId, readStore]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!store) return;
    return store.onChange((id) => {
      if ((id === visitId || id === null) && writing.current === 0) void readStore();
    });
  }, [store, visitId, readStore]);

  const visit = view?.visit ?? null;
  const editable = Boolean(visit && isEditable(visit));

  /** Shows the change at once, saves it on the phone and queues it for the server. */
  const change = useCallback(
    async (op: OpInput): Promise<string | null> => {
      if (!store) return 'The phone’s storage is not ready yet.';
      setView((v) =>
        v ? { ...v, visit: judge(applyOp(v.visit, { ...op, seq: 0, visitId, status: 'PENDING_SYNC', attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: new Date().toISOString() })) } : v,
      );
      writing.current += 1;
      try {
        const { unusedFiles } = await store.enqueue(visitId, op);
        unusedFiles.forEach(deletePhotoFile);
        setSaveError(null);
        requestSync();
        return null;
      } catch {
        const message = 'The change could not be saved on this phone. Try again.';
        setSaveError(message);
        return message;
      } finally {
        writing.current -= 1;
        if (writing.current === 0) await readStore();
      }
    },
    [store, visitId, requestSync, readStore],
  );

  const setFieldError = (id: string, message: string | null) =>
    setLocalErrors((m) => {
      const next = new Map(m);
      if (message) next.set(id, message);
      else next.delete(id);
      return next;
    });

  const responses = useMemo(() => new Map((visit?.responses ?? []).map((r) => [r.checklistItemId, r])), [visit]);
  const readings = useMemo(() => new Map((visit?.readings ?? []).map((r) => [r.readingFieldId, r])), [visit]);
  const refused = view?.ops.find((o) => o.status === 'SYNC_ERROR');
  const fieldErrors = useMemo(() => new Map([...refusedFields(refused), ...localErrors]), [refused, localErrors]);
  const now = () => new Date().toISOString();

  const value: VisitModel = {
    visit,
    loading: loading && !visit,
    error: visit ? null : error,
    responses,
    readings,
    editable,
    syncStatus: view?.syncStatus ?? 'SYNCED',
    syncError: refused ? { message: refused.lastError ?? 'The server refused this change.', kind: refused.kind } : null,
    notice: view?.notice ?? null,
    saveError,
    fieldErrors,
    setResponse: (item, patch) => {
      if (!visit) return;
      const body = responseBody(applyPatch(responses.get(item.id), item.id, patch, item), now());
      const problem = responseProblem(visit, body);
      setFieldError(item.id, problem);
      if (!problem) void change({ kind: 'answers', payload: { responses: [body], readings: [] } });
    },
    setReading: (field, v) => {
      if (!visit) return;
      const b = readingBody(field, v, now());
      const body: ReadingChange = { readingFieldId: b.readingFieldId, numericValue: ('numericValue' in b ? b.numericValue : null) ?? null, textValue: ('textValue' in b ? b.textValue : null) ?? null, clientUpdatedAt: b.clientUpdatedAt };
      const problem = readingProblem(visit, body);
      setFieldError(field.id, problem);
      if (!problem) void change({ kind: 'answers', payload: { responses: [], readings: [body] } });
    },
    setNotApplicable: async (code, notApplicable) => {
      const current = new Set(visit?.notApplicableSections ?? []);
      if (notApplicable) current.add(code);
      else current.delete(code);
      await change({ kind: 'answers', payload: { responses: [], readings: [], notApplicableSections: [...current] } });
    },
    saveOverallComments: (text) => change({ kind: 'answers', payload: { responses: [], readings: [], overallComments: text.trim() || null } }),
    addPhoto: ({ id, uri, checklistItemId, caption, takenAt }) =>
      change({ kind: 'photo', payload: { id, localUri: uri, checklistItemId, ...(caption ? { caption: caption.slice(0, 255) } : {}), takenAt } }),
    deletePhoto: (photoId) => change({ kind: 'photo_delete', payload: { photoId } }),
    saveBatteryUnits: (units) => change({ kind: 'battery', payload: { units: units.map((u) => ({ ...u, clientUpdatedAt: now() })) } }),
    sign: (sig) => change({ kind: 'sign', payload: sig }),
    complete: async () => {
      if (!visit) return { ok: false, message: 'The PM is not loaded.' };
      if (visit.issues.length) return { ok: false, message: completionMessage(visit.issues.length) };
      const message = await change({ kind: 'complete', payload: {} });
      return message ? { ok: false, message } : { ok: true };
    },
    reload: async () => {
      requestSync();
      await load();
    },
    retrySync: async () => {
      await store?.retry(visitId);
      requestSync();
    },
    discardRefused: async () => {
      if (!store || !refused) return { visitRemoved: false };
      const r = await store.discard(refused.seq);
      r.unusedFiles.forEach(deletePhotoFile);
      if (!r.visitRemoved) await readStore();
      return { visitRemoved: r.visitRemoved };
    },
    dismissNotice: async () => {
      await store?.clearNotice(visitId);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVisit(): VisitModel {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVisit must be used inside <VisitProvider>');
  return ctx;
}

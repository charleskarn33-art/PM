import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { File } from 'expo-file-system';
import { sessionClient } from '@/lib/api/session';
import type { ChecklistItem, ReadingField, ReadingRow, ResponsePatch, ResponseRow, VisitDetail } from '@/lib/api/types';
import { errorMessage } from '@/lib/api/use-api';
import { ApiError } from '@/lib/api/session-client';
import { applyPatch, readingBody, responseBody } from './model';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface VisitModel {
  visit: VisitDetail | null;
  loading: boolean;
  error: string | null;
  /** Answers as shown (with edits not yet confirmed by the server). */
  responses: Map<string, ResponseRow>;
  readings: Map<string, ReadingRow>;
  editable: boolean;
  saveState: SaveState;
  saveError: string | null;
  /** Problems the server reported for one answer or reading, by its id. */
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
}

const Ctx = createContext<VisitModel | null>(null);
const SAVE_DELAY_MS = 600;

/**
 * One shared model per open visit. Edits show at once, are sent in batches
 * shortly after the last change (each with the time it was made), and the
 * server's answer — progress, failures, open issues — replaces the local view.
 */
export function VisitProvider({ visitId, children }: { visitId: string; children: ReactNode }) {
  const [visit, setVisit] = useState<VisitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingResponses, setPendingResponses] = useState<Map<string, ResponseRow>>(new Map());
  const [pendingReadings, setPendingReadings] = useState<Map<string, ReadingRow>>(new Map());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Map<string, string>>(new Map());
  const queue = useRef<{ responses: Map<string, object>; readings: Map<string, object> }>({ responses: new Map(), readings: new Map() });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!sessionClient) return;
    try {
      setVisit((await sessionClient.request<VisitDetail>(`/visits/${visitId}`)).data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'open this PM'));
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  useEffect(() => {
    let active = true;
    sessionClient
      ?.request<VisitDetail>(`/visits/${visitId}`)
      .then(
        (r) => active && (setVisit(r.data), setError(null)),
        (e: unknown) => active && setError(errorMessage(e, 'open this PM')),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [visitId]);

  const flush = useCallback(async () => {
    if (!sessionClient) return;
    const batch = queue.current;
    if (!batch.responses.size && !batch.readings.size) return;
    queue.current = { responses: new Map(), readings: new Map() };
    const responses = [...batch.responses.values()];
    const readings = [...batch.readings.values()];
    setSaveState('saving');
    try {
      const { data } = await sessionClient.request<VisitDetail>(`/visits/${visitId}/answers`, { method: 'PUT', body: { responses, readings } });
      setVisit(data);
      setSaveState('saved');
      setSaveError(null);
      setFieldErrors(new Map());
      setPendingResponses((m) => new Map([...m].filter(([id]) => queue.current.responses.has(id))));
      setPendingReadings((m) => new Map([...m].filter(([id]) => queue.current.readings.has(id))));
    } catch (e) {
      setSaveState('error');
      if (e instanceof ApiError && e.code === 'VALIDATION_FAILED' && Array.isArray(e.details)) {
        // Map "responses.3" / "readings.0" back to the item or field id that was refused.
        const errors = new Map<string, string>();
        for (const d of e.details as { path: string; message: string }[]) {
          const [kind, index] = d.path.split('.');
          const sent = kind === 'responses' ? responses[Number(index)] : kind === 'readings' ? readings[Number(index)] : undefined;
          const id = sent && ('checklistItemId' in sent ? sent.checklistItemId : 'readingFieldId' in sent ? sent.readingFieldId : null);
          if (typeof id === 'string') errors.set(id, d.message);
        }
        setFieldErrors(errors);
        setSaveError('Some values were not accepted — see the highlighted answers. Nothing in this batch was saved.');
        // Show the server's copy again for what was refused.
        setPendingResponses(new Map());
        setPendingReadings(new Map());
        await load();
      } else {
        // Keep the edits and try again later (e.g. no connection).
        for (const r of responses) queue.current.responses.set((r as { checklistItemId: string }).checklistItemId, r);
        for (const r of readings) queue.current.readings.set((r as { readingFieldId: string }).readingFieldId, r);
        setSaveError(errorMessage(e, 'save your answers'));
      }
    }
  }, [visitId, load]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush(); // leaving the visit: send what is left
    },
    [flush],
  );

  const responses = useMemo(() => {
    const m = new Map((visit?.responses ?? []).map((r) => [r.checklistItemId, r]));
    for (const [id, r] of pendingResponses) m.set(id, r);
    return m;
  }, [visit, pendingResponses]);

  const readings = useMemo(() => {
    const m = new Map((visit?.readings ?? []).map((r) => [r.readingFieldId, r]));
    for (const [id, r] of pendingReadings) m.set(id, r);
    return m;
  }, [visit, pendingReadings]);

  const editable = visit?.status === 'IN_PROGRESS' || visit?.status === 'REJECTED';

  const setResponse = useCallback(
    (item: ChecklistItem, patch: ResponsePatch) => {
      const next = applyPatch(responses.get(item.id), item.id, patch, item);
      setPendingResponses((m) => new Map(m).set(item.id, next));
      queue.current.responses.set(item.id, responseBody(next, new Date().toISOString()));
      schedule();
    },
    [responses, schedule],
  );

  const setReading = useCallback(
    (field: ReadingField, value: number | string | null) => {
      const row: ReadingRow = {
        readingFieldId: field.id,
        numericValue: typeof value === 'number' ? value : null,
        textValue: typeof value === 'string' ? value : null,
      };
      setPendingReadings((m) => new Map(m).set(field.id, row));
      queue.current.readings.set(field.id, readingBody(field, value, new Date().toISOString()));
      schedule();
    },
    [schedule],
  );

  /** Runs an immediate request (after sending queued answers) and shows the returned visit. */
  const act = useCallback(
    async (path: string, init: { method: string; body?: unknown }, action: string): Promise<string | null> => {
      if (!sessionClient) return 'The app is not configured.';
      await flush();
      try {
        setVisit((await sessionClient.request<VisitDetail>(path, init)).data);
        return null;
      } catch (e) {
        return errorMessage(e, action);
      }
    },
    [flush],
  );

  const value: VisitModel = {
    visit,
    loading,
    error,
    responses,
    readings,
    editable,
    saveState,
    saveError,
    fieldErrors,
    setResponse,
    setReading,
    setNotApplicable: async (code, notApplicable) => {
      const current = new Set(visit?.notApplicableSections ?? []);
      if (notApplicable) current.add(code);
      else current.delete(code);
      const message = await act(`/visits/${visitId}/answers`, { method: 'PUT', body: { notApplicableSections: [...current] } }, 'change the section');
      if (message) setSaveError(message);
    },
    saveOverallComments: (text) => act(`/visits/${visitId}/answers`, { method: 'PUT', body: { overallComments: text } }, 'save the comments'),
    addPhoto: async ({ id, uri, checklistItemId, caption, takenAt }) => {
      if (!sessionClient) return 'The app is not configured.';
      await flush();
      const form = new FormData();
      form.append('id', id);
      if (checklistItemId) form.append('checklistItemId', checklistItemId);
      if (caption) form.append('caption', caption.slice(0, 255));
      form.append('takenAt', takenAt);
      // React Native's FormData takes a file as { uri, name, type }.
      form.append('file', { uri, name: `${id}.jpg`, type: 'image/jpeg' } as unknown as Blob);
      try {
        await sessionClient.upload(`/visits/${visitId}/photos`, form);
        try {
          new File(uri).delete(); // uploaded: the phone's copy is no longer needed
        } catch {
          // Leaving the file is harmless; it is in the app's own folder.
        }
        await load();
        return null;
      } catch (e) {
        return errorMessage(e, 'upload the photo');
      }
    },
    deletePhoto: async (photoId) => {
      if (!sessionClient) return 'The app is not configured.';
      try {
        await sessionClient.request(`/visits/${visitId}/photos/${photoId}`, { method: 'DELETE' }); // 204: no visit returned
        await load();
        return null;
      } catch (e) {
        return errorMessage(e, 'remove the photo');
      }
    },
    saveBatteryUnits: (units) => act(`/visits/${visitId}/battery-units`, { method: 'PUT', body: { units } }, 'save the battery readings'),
    sign: (sig) => act(`/visits/${visitId}/signature`, { method: 'PUT', body: sig }, 'save the signature'),
    complete: async () => {
      if (!sessionClient) return { ok: false, message: 'The app is not configured.' };
      await flush();
      try {
        setVisit((await sessionClient.request<VisitDetail>(`/visits/${visitId}/complete`, { method: 'POST' })).data);
        return { ok: true };
      } catch (e) {
        await load(); // shows the current list of issues
        return { ok: false, message: errorMessage(e, 'complete the PM') };
      }
    },
    reload: load,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVisit(): VisitModel {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVisit must be used inside <VisitProvider>');
  return ctx;
}

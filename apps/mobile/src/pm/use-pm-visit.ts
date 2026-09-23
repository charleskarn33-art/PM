import {
  type ChecklistState,
  type DcThresholds,
  type ConsistencyRule,
  visitIssues,
  visitProgress,
  type Tables,
  type VisitIssue,
  type VisitProgress,
} from '@ipt/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { opKeys } from '@/offline/store';
import type { LocalPhoto, OutboxOp, Site, Visit } from '@/offline/types';
import { useOffline } from '@/providers/offline-provider';
import { EMPTY_RESPONSE, type Field, type Item, type ReadingRow, type ResponseRow } from './model';

type Section = Tables<'pm_sections'>;

/** 'pending': saved on the phone, not sent yet. 'sent': the server has it. 'error': the server refused it. */
export type SaveState = 'pending' | 'sent' | 'error';

export interface PmVisitModel {
  loading: boolean;
  error: string | null;
  visit: Visit | null;
  site: Pick<Site, 'id' | 'site_code' | 'site_name'> | null;
  sections: Section[];
  items: Item[];
  fields: Field[];
  responses: Map<string, ResponseRow>;
  readings: Map<string, ReadingRow>;
  photos: LocalPhoto[];
  photoCounts: Record<string, number>;
  enforcePhotos: boolean;
  dcThresholds: DcThresholds | null;
  progress: VisitProgress;
  issues: VisitIssue[];
  editable: boolean;
  saveState: Record<string, SaveState>;
  /** Changes to this visit the server refused (they hold the visit's later changes). */
  syncErrors: OutboxOp[];
  saveError: string | null;
  setResponse: (itemId: string, patch: Partial<ResponseRow>) => void;
  setReading: (fieldId: string, patch: Partial<ReadingRow>) => void;
  setSectionNotApplicable: (sectionCode: string, notApplicable: boolean) => Promise<void>;
  saveOverallComments: (text: string) => Promise<string | null>;
  submit: () => Promise<string | null>;
  removePhoto: (photoId: string) => Promise<string | null>;
  reload: () => void;
}

const EDITABLE: Visit['status'][] = ['IN_PROGRESS', 'COMPLETED', 'REJECTED'];

interface Loaded {
  visit: Visit;
  site: PmVisitModel['site'];
  sections: Section[];
  items: Item[];
  fields: Field[];
  responses: Map<string, ResponseRow>;
  readings: Map<string, ReadingRow>;
  photos: LocalPhoto[];
  pendingKeys: Set<string>;
  syncErrors: OutboxOp[];
  enforcePhotos: boolean;
  dcThresholds: DcThresholds | null;
  rules: ConsistencyRule[];
}

/**
 * A PM visit read from and written to the phone's offline store. Every
 * change is saved on the phone immediately and queued for sending; the
 * server's answer (failure flags, progress, review) arrives on the next sync.
 */
export function usePmVisit(visitId: string): PmVisitModel {
  const { store, revision, changed, deleteFiles } = useOffline();
  const [data, setDataState] = useState<Loaded | null>(null);
  // Latest data for edits made in quick succession (before React re-renders).
  const dataRef = useRef<Loaded | null>(null);
  const setData = useCallback((next: Loaded | null) => {
    dataRef.current = next;
    setDataState(next);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Writes run one after another; reads wait for queued writes so they never show stale answers.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const writes = useRef(0);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    const startedAt = writes.current;
    chain.current = chain.current
      .then(async () => {
        const vd = await store.visitData(visitId);
        if (!vd) throw new Error('This PM is not on the phone. Pull down on the PM list to sync.');
        const [template, site, settings, rules] = await Promise.all([
          store.template(vd.visit.template_id),
          store.site(vd.visit.site_id),
          store.settings(),
          store.consistencyRules(),
        ]);
        if (!template) throw new Error('The checklist for this PM has not been downloaded yet. Connect to the Internet and sync.');
        const sections = template.sections.filter((s) => s.is_active);
        const loaded: Loaded = {
          visit: vd.visit,
          site: site ? { id: site.id, site_code: site.site_code, site_name: site.site_name } : null,
          sections,
          items: sections.flatMap((s) => s.items).filter((i) => i.is_active).sort((a, b) => a.sort_order - b.sort_order),
          fields: sections.flatMap((s) => s.fields).filter((f) => f.is_active).sort((a, b) => a.sort_order - b.sort_order),
          responses: new Map(vd.responses.map((r) => [r.checklist_item_id, { ...EMPTY_RESPONSE(r.checklist_item_id), ...r }])),
          readings: new Map(vd.readings.map((r) => [r.reading_field_id, r])),
          photos: vd.photos,
          pendingKeys: vd.pendingKeys,
          syncErrors: vd.errors,
          enforcePhotos: settings.pm_submission?.enforce_photo_requirements ?? true,
          dcThresholds: settings.dc_thresholds ?? null,
          rules,
        };
        // A newer edit was made while reading: a fresh read follows it, so skip this one.
        if (!cancelled && writes.current === startedAt) {
          setData(loaded);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, visitId, revision, reloadKey, setData]);

  const write = useCallback(
    (fn: () => Promise<unknown>) => {
      writes.current += 1;
      const p = chain.current.then(fn);
      chain.current = p.catch(() => undefined);
      return p.then(
        () => {
          setSaveError(null);
          changed();
          return null;
        },
        (e: unknown) => {
          const message = `Not saved on the phone: ${e instanceof Error ? e.message : String(e)}`;
          setSaveError(message);
          return message;
        },
      );
    },
    [changed],
  );

  const visit = data?.visit ?? null;
  const editable = visit != null && EDITABLE.includes(visit.status);

  const photoCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of data?.photos ?? []) if (p.checklist_item_id) counts[p.checklist_item_id] = (counts[p.checklist_item_id] ?? 0) + 1;
    return counts;
  }, [data?.photos]);

  const state: ChecklistState = useMemo(
    () => ({
      sections: data?.sections ?? [],
      items: data?.items ?? [],
      readingFields: data?.fields ?? [],
      responses: [...(data?.responses.values() ?? [])],
      readings: [...(data?.readings.values() ?? [])],
      photoCounts,
      notApplicableSections: visit?.not_applicable_sections ?? [],
      enforcePhotoRequirements: data?.enforcePhotos ?? true,
      consistencyRules: data?.rules ?? [],
    }),
    [data, photoCounts, visit?.not_applicable_sections],
  );
  const progress = useMemo(() => visitProgress(state), [state]);
  const issues = useMemo(() => visitIssues(state), [state]);

  const saveState = useMemo(() => {
    const out: Record<string, SaveState> = {};
    if (!data) return out;
    const errorKeys = new Set(data.syncErrors.map((o) => o.key));
    const mark = (id: string, key: string) => {
      out[id] = errorKeys.has(key) ? 'error' : data.pendingKeys.has(key) ? 'pending' : 'sent';
    };
    for (const id of data.responses.keys()) mark(id, opKeys.response(visitId, id));
    for (const id of data.readings.keys()) mark(id, opKeys.reading(visitId, id));
    return out;
  }, [data, visitId]);

  const setResponse = useCallback(
    (itemId: string, patch: Partial<ResponseRow>) => {
      const data = dataRef.current;
      if (!store || !editable || !data) return;
      const row = { ...(data.responses.get(itemId) ?? EMPTY_RESPONSE(itemId)), ...patch };
      setData({
        ...data,
        responses: new Map(data.responses).set(itemId, row),
        pendingKeys: new Set(data.pendingKeys).add(opKeys.response(visitId, itemId)),
      });
      void write(() => store.saveResponse(visitId, row));
    },
    [store, editable, visitId, write, setData],
  );

  const setReading = useCallback(
    (fieldId: string, patch: Partial<ReadingRow>) => {
      const data = dataRef.current;
      if (!store || !editable || !data) return;
      const row = { ...(data.readings.get(fieldId) ?? { reading_field_id: fieldId, numeric_value: null, text_value: null }), ...patch };
      setData({
        ...data,
        readings: new Map(data.readings).set(fieldId, row),
        pendingKeys: new Set(data.pendingKeys).add(opKeys.reading(visitId, fieldId)),
      });
      void write(() => store.saveReading(visitId, row));
    },
    [store, editable, visitId, write, setData],
  );

  const setSectionNotApplicable = useCallback(
    async (code: string, notApplicable: boolean) => {
      const data = dataRef.current;
      if (!store || !data || !editable) return;
      const current = new Set(data.visit.not_applicable_sections);
      if (notApplicable) current.add(code);
      else current.delete(code);
      const list = [...current];
      setData({ ...data, visit: { ...data.visit, not_applicable_sections: list } });
      await write(() => store.updateVisit(visitId, { not_applicable_sections: list }));
    },
    [store, editable, visitId, write, setData],
  );

  const saveOverallComments = useCallback(
    async (text: string) => {
      const data = dataRef.current;
      if (!store || !data) return 'The PM is not loaded.';
      const overall_comments = text.trim() || null;
      setData({ ...data, visit: { ...data.visit, overall_comments } });
      return write(() => store.updateVisit(visitId, { overall_comments }));
    },
    [store, visitId, write, setData],
  );

  const submit = useCallback(async () => {
    const data = dataRef.current;
    if (!store || !data) return 'The PM is not loaded.';
    if (!editable) return 'This PM can no longer be edited.';
    // Same rules the server applies; checked here so the technician can fix them on site.
    if (issues.length > 0) return `${issues.length} item(s) still need attention before this PM can be submitted.`;
    return write(() => store.submitVisit(visitId));
  }, [store, editable, issues.length, visitId, write]);

  const removePhoto = useCallback(
    async (photoId: string) => {
      if (!store) return 'The PM is not loaded.';
      try {
        const files = await store.removeUnsentPhoto(photoId);
        deleteFiles(files);
        changed();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [store, deleteFiles, changed],
  );

  return {
    loading: loading || (!data && !error),
    error,
    visit,
    site: data?.site ?? null,
    sections: data?.sections ?? [],
    items: data?.items ?? [],
    fields: data?.fields ?? [],
    responses: data?.responses ?? new Map(),
    readings: data?.readings ?? new Map(),
    photos: data?.photos ?? [],
    photoCounts,
    enforcePhotos: data?.enforcePhotos ?? true,
    dcThresholds: data?.dcThresholds ?? null,
    progress,
    issues,
    editable,
    saveState,
    syncErrors: data?.syncErrors ?? [],
    saveError,
    setResponse,
    setReading,
    setSectionNotApplicable,
    saveOverallComments,
    submit,
    removePhoto,
    reload: () => setReloadKey((k) => k + 1),
  };
}

import {
  type ConsistencyRule,
  visitIssues,
  visitProgress,
  type ChecklistState,
  type Tables,
  type VisitIssue,
  type VisitProgress,
} from '@ipt/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { describeError } from '@/lib/use-remote-query';
import { EMPTY_RESPONSE, readingUpsert, responseUpsert, type Field, type Item, type ReadingRow, type ResponseRow } from './model';

type Visit = Tables<'pm_visits'>;
type Section = Tables<'pm_sections'>;
type Site = Pick<Tables<'sites'>, 'site_code' | 'site_name'>;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface PmVisitModel {
  loading: boolean;
  error: string | null;
  visit: Visit | null;
  site: Site | null;
  sections: Section[];
  items: Item[];
  fields: Field[];
  responses: Map<string, ResponseRow>;
  readings: Map<string, ReadingRow>;
  photoCounts: Record<string, number>;
  enforcePhotos: boolean;
  progress: VisitProgress;
  issues: VisitIssue[];
  editable: boolean;
  saveState: Record<string, SaveState>;
  saveError: string | null;
  setResponse: (itemId: string, patch: Partial<ResponseRow>) => void;
  setReading: (fieldId: string, patch: Partial<ReadingRow>) => void;
  setSectionNotApplicable: (sectionCode: string, notApplicable: boolean) => Promise<void>;
  saveOverallComments: (text: string) => Promise<string | null>;
  submit: () => Promise<string | null>;
  retryFailed: () => void;
  reload: () => void;
}

const EDITABLE: Visit['status'][] = ['IN_PROGRESS', 'COMPLETED', 'REJECTED'];

/**
 * Loads a PM visit with its template and answers, and saves every change
 * immediately (online). Pending/failed saves are kept and retried on request.
 * Phase 5 replaces the transport with the SQLite outbox; the UI contract stays.
 */
export function usePmVisit(visitId: string): PmVisitModel {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [responses, setResponses] = useState(new Map<string, ResponseRow>());
  const [readings, setReadings] = useState(new Map<string, ReadingRow>());
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [enforcePhotos, setEnforcePhotos] = useState(true);
  const [rules, setRules] = useState<ConsistencyRule[]>([]);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const failed = useRef(new Map<string, () => Promise<void>>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) throw new Error('Not configured.');
      const v = await supabase.from('pm_visits').select('*').eq('id', visitId).single();
      if (v.error) throw new Error(v.error.message);
      const [siteRes, secRes, respRes, readRes, photoRes, settingRes, rulesRes] = await Promise.all([
        supabase.from('sites').select('site_code, site_name').eq('id', v.data.site_id).maybeSingle(),
        supabase
          .from('pm_sections')
          .select('*, pm_checklist_items(*), pm_reading_fields(*)')
          .eq('template_id', v.data.template_id)
          .order('sort_order'),
        supabase.from('pm_responses').select('*').eq('visit_id', visitId),
        supabase.from('pm_readings').select('reading_field_id, numeric_value, text_value').eq('visit_id', visitId),
        supabase.from('pm_photos').select('checklist_item_id').eq('visit_id', visitId),
        supabase.from('system_settings').select('value').eq('key', 'pm_submission').maybeSingle(),
        supabase.from('pm_consistency_rules').select('id, lhs_key, operator, rhs_key, message, is_active').eq('is_active', true),
      ]);
      for (const r of [siteRes, secRes, respRes, readRes, photoRes, settingRes, rulesRes]) if (r.error) throw new Error(r.error.message);
      if (cancelled) return;
      const secs = secRes.data ?? [];
      setVisit(v.data);
      setSite(siteRes.data ?? null);
      setSections(secs.filter((s) => s.is_active));
      setItems(secs.flatMap((s) => s.pm_checklist_items).filter((i) => i.is_active).sort((a, b) => a.sort_order - b.sort_order));
      setFields(secs.flatMap((s) => s.pm_reading_fields).filter((f) => f.is_active).sort((a, b) => a.sort_order - b.sort_order));
      setResponses(new Map((respRes.data ?? []).map((r) => [r.checklist_item_id, r])));
      setReadings(new Map((readRes.data ?? []).map((r) => [r.reading_field_id, r])));
      const counts: Record<string, number> = {};
      for (const p of photoRes.data ?? []) if (p.checklist_item_id) counts[p.checklist_item_id] = (counts[p.checklist_item_id] ?? 0) + 1;
      setPhotoCounts(counts);
      setRules(rulesRes.data ?? []);
      setEnforcePhotos((settingRes.data?.value as { enforce_photo_requirements?: boolean } | null)?.enforce_photo_requirements ?? true);
      setError(null);
    })()
      .catch((e: unknown) => {
        if (!cancelled) setError(describeError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visitId, version]);

  const editable = visit != null && EDITABLE.includes(visit.status);

  const state: ChecklistState = useMemo(
    () => ({
      sections,
      items,
      readingFields: fields,
      responses: [...responses.values()],
      readings: [...readings.values()],
      photoCounts,
      notApplicableSections: visit?.not_applicable_sections ?? [],
      enforcePhotoRequirements: enforcePhotos,
      consistencyRules: rules,
    }),
    [sections, items, fields, responses, readings, photoCounts, visit?.not_applicable_sections, enforcePhotos, rules],
  );
  const progress = useMemo(() => visitProgress(state), [state]);
  const issues = useMemo(() => visitIssues(state), [state]);

  const persist = useCallback(async (key: string, write: () => Promise<{ error: { message: string } | null }>) => {
    setSaveState((s) => ({ ...s, [key]: 'saving' }));
    const attempt = async () => {
      const { error: err } = await write();
      if (err) throw new Error(err.message);
    };
    try {
      await attempt();
      failed.current.delete(key);
      setSaveState((s) => ({ ...s, [key]: 'saved' }));
      if (failed.current.size === 0) setSaveError(null);
    } catch (e) {
      failed.current.set(key, attempt);
      setSaveState((s) => ({ ...s, [key]: 'error' }));
      setSaveError(`Not saved: ${describeError(e)} Your answers are kept on this screen; tap "Retry" when online.`);
    }
  }, []);

  // Latest values for building the next row outside React state updaters
  // (updaters must stay pure; the save is a side effect).
  const responsesRef = useRef(responses);
  const readingsRef = useRef(readings);
  useEffect(() => {
    responsesRef.current = responses;
    readingsRef.current = readings;
  }, [responses, readings]);

  const setResponse = useCallback(
    (itemId: string, patch: Partial<ResponseRow>) => {
      if (!supabase || !editable) return;
      const client = supabase;
      const row = { ...(responsesRef.current.get(itemId) ?? EMPTY_RESPONSE(itemId)), ...patch };
      responsesRef.current = new Map(responsesRef.current).set(itemId, row);
      setResponses(responsesRef.current);
      void persist(itemId, async () =>
        client
          .from('pm_responses')
          .upsert(responseUpsert(visitId, row, new Date().toISOString()), { onConflict: 'visit_id,checklist_item_id' }),
      );
    },
    [editable, persist, visitId],
  );

  const setReading = useCallback(
    (fieldId: string, patch: Partial<ReadingRow>) => {
      if (!supabase || !editable) return;
      const client = supabase;
      const row = {
        ...(readingsRef.current.get(fieldId) ?? { reading_field_id: fieldId, numeric_value: null, text_value: null }),
        ...patch,
      };
      readingsRef.current = new Map(readingsRef.current).set(fieldId, row);
      setReadings(readingsRef.current);
      void persist(fieldId, async () =>
        client
          .from('pm_readings')
          .upsert(readingUpsert(visitId, row, new Date().toISOString()), { onConflict: 'visit_id,reading_field_id' }),
      );
    },
    [editable, persist, visitId],
  );

  const setSectionNotApplicable = useCallback(
    async (code: string, notApplicable: boolean) => {
      if (!supabase || !visit) return;
      const current = new Set(visit.not_applicable_sections);
      if (notApplicable) current.add(code);
      else current.delete(code);
      const list = [...current];
      const { data, error: err } = await supabase
        .from('pm_visits')
        .update({ not_applicable_sections: list })
        .eq('id', visitId)
        .select('*')
        .single();
      if (err) setSaveError(`Could not update the section: ${describeError(new Error(err.message))}`);
      else setVisit(data);
    },
    [visit, visitId],
  );

  const saveOverallComments = useCallback(
    async (text: string) => {
      if (!supabase) return 'Not configured.';
      const { data, error: err } = await supabase
        .from('pm_visits')
        .update({ overall_comments: text.trim() || null })
        .eq('id', visitId)
        .select('*')
        .single();
      if (err) return describeError(new Error(err.message));
      setVisit(data);
      return null;
    },
    [visitId],
  );

  const submit = useCallback(async () => {
    if (!supabase) return 'Not configured.';
    if (failed.current.size > 0) return 'Some answers are not saved yet. Tap "Retry" when you have Internet, then submit.';
    const { data, error: err } = await supabase
      .from('pm_visits')
      .update({ status: 'SUBMITTED', ended_at: new Date().toISOString() })
      .eq('id', visitId)
      .select('*')
      .single();
    if (err) return describeError(new Error(err.message));
    setVisit(data);
    return null;
  }, [visitId]);

  const retryFailed = useCallback(() => {
    for (const [key, attempt] of failed.current) {
      void persist(key, async () => {
        try {
          await attempt();
          return { error: null };
        } catch (e) {
          return { error: { message: describeError(e) } };
        }
      });
    }
  }, [persist]);

  return {
    loading,
    error,
    visit,
    site,
    sections,
    items,
    fields,
    responses,
    readings,
    photoCounts,
    enforcePhotos,
    progress,
    issues,
    editable,
    saveState,
    saveError,
    setResponse,
    setReading,
    setSectionNotApplicable,
    saveOverallComments,
    submit,
    retryFailed,
    reload: () => setVersion((v) => v + 1),
  };
}

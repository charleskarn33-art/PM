import 'server-only';
import type { ChecklistState, Database, DcThresholds, Tables, VisitIssue } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

type Client = SupabaseClient<Database>;

export interface VisitAnalytics {
  generator: Tables<'generator_readings'> | null;
  dc: Tables<'dc_readings'> | null;
  phases: Tables<'dc_phase_currents'>[];
  battery: Tables<'battery_readings'> | null;
  solar: Tables<'solar_readings'> | null;
  earthing: Tables<'earthing_readings'> | null;
}

/** Section analytics rows projected by the database from the visit's answers. */
export async function loadVisitAnalytics(supabase: Client, visitId: string): Promise<VisitAnalytics> {
  const [generator, dc, phases, battery, solar, earthing] = await Promise.all([
    supabase.from('generator_readings').select('*').eq('visit_id', visitId).maybeSingle(),
    supabase.from('dc_readings').select('*').eq('visit_id', visitId).maybeSingle(),
    supabase.from('dc_phase_currents').select('*').eq('visit_id', visitId).order('phase_number'),
    supabase.from('battery_readings').select('*').eq('visit_id', visitId).maybeSingle(),
    supabase.from('solar_readings').select('*').eq('visit_id', visitId).maybeSingle(),
    supabase.from('earthing_readings').select('*').eq('visit_id', visitId).maybeSingle(),
  ]);
  return {
    generator: must('generator readings', generator),
    dc: must('DC readings', dc),
    phases: must('phase currents', phases),
    battery: must('battery readings', battery),
    solar: must('solar readings', solar),
    earthing: must('earthing readings', earthing),
  };
}

export interface VisitDetail {
  analytics: VisitAnalytics;
  visit: Tables<'pm_visit_overview'>;
  raw: Tables<'pm_visits'>;
  sections: Tables<'pm_sections'>[];
  items: Tables<'pm_checklist_items'>[];
  readingFields: Tables<'pm_reading_fields'>[];
  responses: Tables<'pm_responses'>[];
  readings: Tables<'pm_readings'>[];
  photoCounts: Record<string, number>;
  photos: VisitPhoto[];
  dcThresholds: DcThresholds | null;
  issues: VisitIssue[];
  state: ChecklistState;
}

export type VisitPhoto = Pick<
  Tables<'pm_photos'>,
  'id' | 'checklist_item_id' | 'section_id' | 'file_path' | 'thumbnail_path' | 'taken_at' | 'caption'
>;

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Unable to load ${label}: ${r.error.message}`);
  return r.data as T;
}

/** Everything the review page needs, read as the signed-in user (RLS). */
export async function loadVisitDetail(supabase: Client, id: string): Promise<VisitDetail | null> {
  const [overview, raw] = await Promise.all([
    supabase.from('pm_visit_overview').select('*').eq('id', id).maybeSingle(),
    supabase.from('pm_visits').select('*').eq('id', id).maybeSingle(),
  ]);
  const visit = must('PM visit', overview);
  const visitRow = must('PM visit', raw);
  if (!visit || !visitRow) return null;

  const sections = must(
    'sections',
    await supabase.from('pm_sections').select('*').eq('template_id', visitRow.template_id).order('sort_order'),
  );
  const sectionIds = sections.map((s) => s.id);
  const [items, fields, responses, readings, photos, issues, rules, analytics, dcSetting] = await Promise.all([
    supabase.from('pm_checklist_items').select('*').in('section_id', sectionIds).order('sort_order'),
    supabase.from('pm_reading_fields').select('*').in('section_id', sectionIds).order('sort_order'),
    supabase.from('pm_responses').select('*').eq('visit_id', id),
    supabase.from('pm_readings').select('*').eq('visit_id', id),
    supabase
      .from('pm_photos')
      .select('id, checklist_item_id, section_id, file_path, thumbnail_path, taken_at, caption')
      .eq('visit_id', id)
      .order('taken_at'),
    supabase.rpc('pm_visit_issues', { p_visit_id: id }),
    supabase.from('pm_consistency_rules').select('id, lhs_key, operator, rhs_key, message, is_active').eq('is_active', true),
    loadVisitAnalytics(supabase, id),
    supabase.from('system_settings').select('value').eq('key', 'dc_thresholds').maybeSingle(),
  ]);
  const photoRows = must('photos', photos);
  const photoCounts: Record<string, number> = {};
  for (const p of photoRows) {
    if (p.checklist_item_id) photoCounts[p.checklist_item_id] = (photoCounts[p.checklist_item_id] ?? 0) + 1;
  }
  const consistencyRules = must('consistency rules', rules);
  const detail = {
    analytics,
    visit,
    raw: visitRow,
    sections,
    items: must('checklist items', items),
    readingFields: must('reading fields', fields),
    responses: must('responses', responses),
    readings: must('readings', readings),
    photoCounts,
    photos: photoRows,
    dcThresholds: (must('DC thresholds', dcSetting)?.value as unknown as DcThresholds | undefined) ?? null,
    issues: must('issues', issues).map((i) => ({
      sectionCode: i.section_code,
      refType: i.ref_type as 'item' | 'reading',
      refId: i.ref_id,
      label: i.label,
      issue: i.issue as VisitIssue['issue'],
    })),
  };
  return {
    ...detail,
    state: {
      sections: detail.sections,
      items: detail.items,
      readingFields: detail.readingFields,
      responses: detail.responses,
      readings: detail.readings,
      photoCounts,
      notApplicableSections: visitRow.not_applicable_sections,
      consistencyRules,
    },
  };
}

/**
 * Short-lived signed URLs for photo thumbnails and full images (private
 * bucket). Returns an empty map when Storage is unreachable so the page still
 * renders; photos then show as "not available".
 */
export async function signPhotoUrls(
  supabase: Client,
  photos: VisitPhoto[],
  expiresInSeconds = 3600,
): Promise<Map<string, { thumb: string | null; full: string | null }>> {
  const out = new Map<string, { thumb: string | null; full: string | null }>();
  if (photos.length === 0) return out;
  const paths = [...new Set(photos.flatMap((p) => [p.file_path, p.thumbnail_path].filter((x): x is string => !!x)))];
  try {
    const { data, error } = await supabase.storage.from('pm-photos').createSignedUrls(paths, expiresInSeconds);
    if (error || !data) return out;
    const byPath = new Map(data.filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
    for (const p of photos) {
      const full = byPath.get(p.file_path) ?? null;
      out.set(p.id, { full, thumb: (p.thumbnail_path ? byPath.get(p.thumbnail_path) : null) ?? full });
    }
  } catch {
    // Storage unavailable: the page shows photo placeholders.
  }
  return out;
}

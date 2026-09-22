import 'server-only';
import type { ChecklistState, Database, Tables, VisitIssue } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

type Client = SupabaseClient<Database>;

export interface VisitDetail {
  visit: Tables<'pm_visit_overview'>;
  raw: Tables<'pm_visits'>;
  sections: Tables<'pm_sections'>[];
  items: Tables<'pm_checklist_items'>[];
  readingFields: Tables<'pm_reading_fields'>[];
  responses: Tables<'pm_responses'>[];
  readings: Tables<'pm_readings'>[];
  photoCounts: Record<string, number>;
  issues: VisitIssue[];
  state: ChecklistState;
}

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
  const [items, fields, responses, readings, photos, issues] = await Promise.all([
    supabase.from('pm_checklist_items').select('*').in('section_id', sectionIds).order('sort_order'),
    supabase.from('pm_reading_fields').select('*').in('section_id', sectionIds).order('sort_order'),
    supabase.from('pm_responses').select('*').eq('visit_id', id),
    supabase.from('pm_readings').select('*').eq('visit_id', id),
    supabase.from('pm_photos').select('checklist_item_id').eq('visit_id', id),
    supabase.rpc('pm_visit_issues', { p_visit_id: id }),
  ]);
  const photoCounts: Record<string, number> = {};
  for (const p of must('photos', photos)) {
    if (p.checklist_item_id) photoCounts[p.checklist_item_id] = (photoCounts[p.checklist_item_id] ?? 0) + 1;
  }
  const detail = {
    visit,
    raw: visitRow,
    sections,
    items: must('checklist items', items),
    readingFields: must('reading fields', fields),
    responses: must('responses', responses),
    readings: must('readings', readings),
    photoCounts,
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
    },
  };
}

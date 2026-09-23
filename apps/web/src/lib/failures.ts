import 'server-only';
import type { Database, Tables } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VisitPhoto } from './pm-visit';

type Client = SupabaseClient<Database>;

export interface FailureDetail {
  failure: Tables<'failure_overview'>;
  actions: Tables<'corrective_action_overview'>[];
  photos: VisitPhoto[];
}

const PHOTO_COLUMNS = 'id, checklist_item_id, section_id, file_path, thumbnail_path, taken_at, caption';

/** A failure with its corrective actions and the PM evidence photos for its checklist item (RLS applies). */
export async function loadFailureDetail(supabase: Client, id: string): Promise<FailureDetail | null> {
  const { data: failure, error } = await supabase.from('failure_overview').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Unable to load failure: ${error.message}`);
  if (!failure) return null;
  const [actions, photos] = await Promise.all([
    supabase.from('corrective_action_overview').select('*').eq('failure_id', id).order('created_at'),
    failure.visit_id && failure.checklist_item_id
      ? supabase.from('pm_photos').select(PHOTO_COLUMNS).eq('visit_id', failure.visit_id).eq('checklist_item_id', failure.checklist_item_id).order('taken_at')
      : supabase.from('pm_photos').select(PHOTO_COLUMNS).eq('failure_id', id).order('taken_at'),
  ]);
  if (actions.error) throw new Error(`Unable to load corrective actions: ${actions.error.message}`);
  if (photos.error) throw new Error(`Unable to load photos: ${photos.error.message}`);
  return { failure, actions: actions.data ?? [], photos: photos.data ?? [] };
}

export interface Assignee {
  id: string;
  full_name: string;
  role: Database['public']['Enums']['app_role'];
}

/** People the caller may assign an action at this site to (empty when the caller cannot manage the site). */
export async function loadAssignees(supabase: Client, siteId: string): Promise<Assignee[]> {
  const { data, error } = await supabase.rpc('corrective_action_assignees', { p_site_id: siteId });
  if (error) throw new Error(`Unable to load assignees: ${error.message}`);
  return (data ?? []) as Assignee[];
}

/** Whether the signed-in user manages this site (controls shown in the UI; the database enforces writes). */
export async function canManageSite(supabase: Client, siteId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_manage_site', { p_site_id: siteId });
  if (error) throw new Error(`Unable to check permissions: ${error.message}`);
  return data === true;
}

import 'server-only';
import type { Database, Enums, Tables } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VisitPhoto } from './pm-visit';

type Client = SupabaseClient<Database>;

export interface ActionUpdate {
  id: string;
  from_status: Enums<'corrective_action_status'> | null;
  to_status: Enums<'corrective_action_status'> | null;
  note: string | null;
  created_at: string;
  author_name: string;
}

export interface ActionDetail {
  action: Tables<'corrective_action_overview'>;
  updates: ActionUpdate[];
  photos: VisitPhoto[];
}

export async function loadActionDetail(supabase: Client, id: string): Promise<ActionDetail | null> {
  const { data: action, error } = await supabase.from('corrective_action_overview').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Unable to load corrective action: ${error.message}`);
  if (!action) return null;
  const [updates, photos] = await Promise.all([
    supabase
      .from('corrective_action_updates')
      .select('id, from_status, to_status, note, created_at, profiles!corrective_action_updates_author_id_fkey(full_name, email)')
      .eq('corrective_action_id', id)
      .order('created_at'),
    supabase
      .from('pm_photos')
      .select('id, checklist_item_id, section_id, file_path, thumbnail_path, taken_at, caption')
      .eq('corrective_action_id', id)
      .order('taken_at'),
  ]);
  if (updates.error) throw new Error(`Unable to load the timeline: ${updates.error.message}`);
  if (photos.error) throw new Error(`Unable to load photos: ${photos.error.message}`);
  return {
    action,
    updates: (updates.data ?? []).map((u) => ({
      id: u.id,
      from_status: u.from_status,
      to_status: u.to_status,
      note: u.note,
      created_at: u.created_at,
      author_name: u.profiles?.full_name || u.profiles?.email || 'Unknown',
    })),
    photos: photos.data ?? [],
  };
}

import 'server-only';
import { PM_CATEGORIES, PRIORITIES, SEVERITIES, type Database, type Enums } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toIlikePattern } from './table-params';

type Client = SupabaseClient<Database>;
type Filters = Record<string, string>;

export const VISIT_STATUSES: Enums<'pm_status'>[] = ['SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED', 'CANCELLED'];
export const FAILURE_STATUSES: Enums<'failure_status'>[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED'];
const FAILURE_ACTIVE: Enums<'failure_status'>[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];
export const ACTION_STATUSES: Enums<'corrective_action_status'>[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];
const ACTION_ACTIVE: Enums<'corrective_action_status'>[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

/**
 * The list filters, shared by each list page and its CSV export so an export
 * always contains exactly what the list shows. RLS limits every result.
 */
export function visitListQuery(supabase: Client, q: string, f: Filters) {
  const status = f.status ?? 'SUBMITTED';
  let query = supabase.from('pm_visit_overview').select('*', { count: 'exact' });
  if (status !== 'ALL' && (VISIT_STATUSES as string[]).includes(status)) query = query.eq('status', status as Enums<'pm_status'>);
  if (f.from) query = query.gte('started_at', `${f.from}T00:00:00`);
  if (f.to) query = query.lte('started_at', `${f.to}T23:59:59.999`);
  if (q) {
    const p = toIlikePattern(q);
    query = query.or(`site_code.ilike.${p},site_name.ilike.${p},technician_name.ilike.${p}`);
  }
  return query;
}

export function failureListQuery(supabase: Client, q: string, f: Filters) {
  const status = f.status ?? 'ACTIVE';
  let query = supabase.from('failure_overview').select('*', { count: 'exact' });
  if (status === 'ACTIVE') query = query.in('status', FAILURE_ACTIVE);
  else if ((FAILURE_STATUSES as string[]).includes(status)) query = query.eq('status', status as Enums<'failure_status'>);
  if (f.severity && (SEVERITIES as string[]).includes(f.severity)) query = query.eq('severity', f.severity as Enums<'severity_level'>);
  if (f.category && (PM_CATEGORIES as string[]).includes(f.category)) query = query.eq('category', f.category as Enums<'pm_category'>);
  if (f.source === 'PM_CHECKLIST' || f.source === 'MANUAL') query = query.eq('source', f.source);
  if (f.from) query = query.gte('detected_at', `${f.from}T00:00:00`);
  if (f.to) query = query.lte('detected_at', `${f.to}T23:59:59.999`);
  if (q) {
    const p = toIlikePattern(q);
    query = query.or(`failure_number.ilike.${p},site_code.ilike.${p},site_name.ilike.${p},description.ilike.${p}`);
  }
  return query;
}

export function actionListQuery(supabase: Client, q: string, f: Filters, userId: string) {
  const status = f.status ?? 'ACTIVE';
  let query = supabase.from('corrective_action_overview').select('*', { count: 'exact' });
  if (status === 'ACTIVE') query = query.in('status', ACTION_ACTIVE);
  else if (status === 'REVIEW') query = query.eq('status', 'COMPLETED');
  else if ((ACTION_STATUSES as string[]).includes(status)) query = query.eq('status', status as Enums<'corrective_action_status'>);
  if (f.priority && (PRIORITIES as string[]).includes(f.priority)) query = query.eq('priority', f.priority as Enums<'priority_level'>);
  if (f.overdue === '1') query = query.eq('is_overdue', true);
  if (f.mine === '1') query = query.eq('assigned_to', userId);
  if (q) {
    const p = toIlikePattern(q);
    query = query.or(`action_number.ilike.${p},site_code.ilike.${p},site_name.ilike.${p},description.ilike.${p},assignee_name.ilike.${p},failure_number.ilike.${p}`);
  }
  return query;
}

/** Audit log filters (Super Admin; RLS returns nothing to anyone else). */
export function auditListQuery(supabase: Client, q: string, f: Filters) {
  let query = supabase.from('audit_log_overview').select('*', { count: 'exact' });
  if (f.action) query = query.eq('action', f.action);
  if (f.entity) query = query.eq('entity_type', f.entity);
  if (f.from) query = query.gte('created_at', `${f.from}T00:00:00`);
  if (f.to) query = query.lte('created_at', `${f.to}T23:59:59.999`);
  if (q) {
    const p = toIlikePattern(q);
    query = query.or(`action.ilike.${p},entity_type.ilike.${p},actor_name.ilike.${p},actor_email.ilike.${p}`);
  }
  return query;
}

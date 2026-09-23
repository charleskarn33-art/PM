-- =============================================================================
-- Phase 9 (found by the end-to-end tests): a supervisor who assigned a
-- corrective action to a Maintenance user could not see that user's name —
-- Maintenance users have no region, so they were outside the supervisor's
-- visible profiles. People named on corrective actions are now visible:
--   managers / supervisors: assignee, assigner and verifier of actions on
--                           sites they can access;
--   the assignee of an action: who assigned and who verified it.
-- =============================================================================
create or replace function private.visible_profile_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  -- managers / supervisors: people in their regions and their technicians
  select p.id from public.profiles p
   where private.has_any_role('regional_manager', 'regional_supervisor')
     and p.region_id in (select private.scoped_region_ids())
  union
  select t.id from public.technicians t
   where private.has_any_role('regional_manager', 'regional_supervisor')
     and (t.region_id in (select private.scoped_region_ids()) or t.supervisor_id = auth.uid())
  union
  select u.profile_id from public.user_region_scopes u
   where private.has_any_role('regional_manager', 'regional_supervisor')
     and u.region_id in (select private.scoped_region_ids())
  union
  -- managers / supervisors: people named on corrective actions in scope
  select x.id from public.corrective_actions ca
   cross join lateral (values (ca.assigned_to), (ca.assigned_by), (ca.verified_by)) as x(id)
   where private.has_any_role('regional_manager', 'regional_supervisor')
     and x.id is not null
     and ca.site_id in (select private.accessible_site_ids())
  union
  -- assignees: who gave them the work and who verified it
  select x.id from public.corrective_actions ca
   cross join lateral (values (ca.assigned_by), (ca.verified_by)) as x(id)
   where ca.assigned_to = auth.uid() and x.id is not null
  union
  -- technicians: their supervisor
  select t.supervisor_id from public.technicians t
   where t.id = auth.uid() and t.supervisor_id is not null
     and private.has_any_role('technician')
$$;

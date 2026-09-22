-- =============================================================================
-- Row Level Security policies for every table in `public`.
--
-- Conventions
--   * Every policy targets `authenticated`; `anon` has no table privileges.
--   * Helper calls are wrapped in (select ...) so Postgres evaluates them once
--     per statement instead of once per row.
--   * Derived/analytics tables and audit_logs have no write policies: they are
--     written only by SECURITY DEFINER functions and triggers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Privileges (defence in depth on top of RLS)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- profiles: users may only edit their own contact details. Role, activation and
-- region changes go through public.admin_update_user().
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

-- notifications: recipients may only mark as read.
revoke insert, update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- append-only / system-written tables
revoke insert, update, delete on public.audit_logs from authenticated;
revoke update, delete on public.corrective_action_updates from authenticated;
revoke insert, update, delete on public.roles from authenticated;
revoke insert, update, delete on public.generator_readings, public.dc_readings, public.dc_phase_currents,
  public.battery_readings, public.solar_readings, public.earthing_readings from authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS on every table in public.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reference / configuration data: readable by any active user,
-- writable by Super Admin only.
-- -----------------------------------------------------------------------------
create policy roles_select on public.roles
  for select to authenticated using ((select private.is_active_user()));

do $$
declare
  t text;
begin
  foreach t in array array['regions', 'clusters', 'counties', 'pm_templates', 'pm_sections',
                           'pm_reading_fields', 'pm_checklist_items', 'system_settings'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using ((select private.is_active_user()))', t);
    execute format(
      'create policy %1$s_admin_insert on public.%1$I for insert to authenticated
         with check ((select private.is_admin()))', t);
    execute format(
      'create policy %1$s_admin_update on public.%1$I for update to authenticated
         using ((select private.is_admin())) with check ((select private.is_admin()))', t);
    execute format(
      'create policy %1$s_admin_delete on public.%1$I for delete to authenticated
         using ((select private.is_admin()))', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_org_wide_reader())
    or id in (select private.visible_profile_ids())
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- user_region_scopes
-- -----------------------------------------------------------------------------
create policy user_region_scopes_select on public.user_region_scopes
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_org_wide_reader())
    or region_id in (select private.scoped_region_ids())
  );
create policy user_region_scopes_admin_insert on public.user_region_scopes
  for insert to authenticated with check ((select private.is_admin()));
create policy user_region_scopes_admin_update on public.user_region_scopes
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy user_region_scopes_admin_delete on public.user_region_scopes
  for delete to authenticated using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- supervisors / technicians
-- -----------------------------------------------------------------------------
create policy supervisors_select on public.supervisors
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_org_wide_reader())
    or id in (select private.visible_profile_ids())
  );
create policy supervisors_admin_insert on public.supervisors
  for insert to authenticated with check ((select private.is_admin()));
create policy supervisors_admin_update on public.supervisors
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy supervisors_admin_delete on public.supervisors
  for delete to authenticated using ((select private.is_admin()));

create policy technicians_select on public.technicians
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_org_wide_reader())
    or id in (select private.visible_profile_ids())
  );
create policy technicians_admin_insert on public.technicians
  for insert to authenticated with check ((select private.is_admin()));
create policy technicians_manage_update on public.technicians
  for update to authenticated
  using (
    (select private.is_admin())
    or ((select private.has_any_role('regional_supervisor')) and supervisor_id = (select auth.uid()))
  )
  with check (
    (select private.is_admin())
    or ((select private.has_any_role('regional_supervisor')) and supervisor_id = (select auth.uid()))
  );
create policy technicians_admin_delete on public.technicians
  for delete to authenticated using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- sites
-- -----------------------------------------------------------------------------
create policy sites_select on public.sites
  for select to authenticated
  using ((select private.is_org_wide_reader()) or id in (select private.accessible_site_ids()));
create policy sites_admin_insert on public.sites
  for insert to authenticated with check ((select private.is_admin()));
create policy sites_admin_update on public.sites
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sites_admin_delete on public.sites
  for delete to authenticated using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- site_assignments
-- -----------------------------------------------------------------------------
create policy site_assignments_select on public.site_assignments
  for select to authenticated
  using (
    (select private.is_org_wide_reader())
    or (technician_id = (select auth.uid()) and (select private.has_any_role('technician')))
    or site_id in (select private.scoped_site_ids())
  );
create policy site_assignments_manage_insert on public.site_assignments
  for insert to authenticated with check (private.can_manage_site(site_id));
create policy site_assignments_manage_update on public.site_assignments
  for update to authenticated
  using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
create policy site_assignments_manage_delete on public.site_assignments
  for delete to authenticated using (private.can_manage_site(site_id));

-- -----------------------------------------------------------------------------
-- pm_schedules
-- -----------------------------------------------------------------------------
create policy pm_schedules_select on public.pm_schedules
  for select to authenticated
  using (
    (select private.is_org_wide_reader())
    or (technician_id = (select auth.uid()) and (select private.has_any_role('technician')))
    or site_id in (select private.scoped_site_ids())
  );
create policy pm_schedules_manage_insert on public.pm_schedules
  for insert to authenticated with check (private.can_manage_site(site_id));
create policy pm_schedules_manage_update on public.pm_schedules
  for update to authenticated
  using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
create policy pm_schedules_admin_delete on public.pm_schedules
  for delete to authenticated using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- pm_visits (workflow rules enforced by private.guard_pm_visit)
-- -----------------------------------------------------------------------------
create policy pm_visits_select on public.pm_visits
  for select to authenticated
  using (
    (select private.is_org_wide_reader())
    or (technician_id = (select auth.uid()) and (select private.has_any_role('technician')))
    or site_id in (select private.scoped_site_ids())
    or private.can_read_visit(id)
  );
create policy pm_visits_technician_insert on public.pm_visits
  for insert to authenticated
  with check (
    technician_id = (select auth.uid())
    and (select private.has_any_role('technician'))
    and site_id in (select private.technician_site_ids())
  );
create policy pm_visits_update on public.pm_visits
  for update to authenticated
  using (
    (technician_id = (select auth.uid()) and (select private.has_any_role('technician')))
    or private.can_review_visit(site_id)
  )
  with check (
    (technician_id = (select auth.uid()) and (select private.has_any_role('technician')))
    or private.can_review_visit(site_id)
  );
create policy pm_visits_admin_delete on public.pm_visits
  for delete to authenticated using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- pm_responses / pm_readings
-- -----------------------------------------------------------------------------
create policy pm_responses_select on public.pm_responses
  for select to authenticated
  using ((select private.is_org_wide_reader()) or private.can_read_visit(visit_id));
create policy pm_responses_insert on public.pm_responses
  for insert to authenticated with check (private.can_edit_visit(visit_id));
create policy pm_responses_update on public.pm_responses
  for update to authenticated
  using (private.can_edit_visit(visit_id)) with check (private.can_edit_visit(visit_id));
create policy pm_responses_delete on public.pm_responses
  for delete to authenticated using (private.can_edit_visit(visit_id));

create policy pm_readings_select on public.pm_readings
  for select to authenticated
  using ((select private.is_org_wide_reader()) or private.can_read_visit(visit_id));
create policy pm_readings_insert on public.pm_readings
  for insert to authenticated with check (private.can_edit_visit(visit_id));
create policy pm_readings_update on public.pm_readings
  for update to authenticated
  using (private.can_edit_visit(visit_id)) with check (private.can_edit_visit(visit_id));
create policy pm_readings_delete on public.pm_readings
  for delete to authenticated using (private.can_edit_visit(visit_id));

-- -----------------------------------------------------------------------------
-- Section analytics tables (read-only to clients)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['generator_readings', 'dc_readings', 'dc_phase_currents',
                           'battery_readings', 'solar_readings', 'earthing_readings'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using ((select private.is_org_wide_reader())
                or site_id in (select private.scoped_site_ids())
                or private.can_read_visit(visit_id))', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- failures
-- -----------------------------------------------------------------------------
create policy failures_select on public.failures
  for select to authenticated
  using (
    (select private.is_org_wide_reader())
    or site_id in (select private.scoped_site_ids())
    or ((select private.has_any_role('technician'))
        and (technician_id = (select auth.uid()) or site_id in (select private.technician_site_ids())))
    or id in (select ca.failure_id from public.corrective_actions ca
               where ca.assigned_to = (select auth.uid()) and ca.failure_id is not null)
  );
-- Manual failures: technicians on their assigned sites, supervisors in scope.
-- Checklist failures are created server-side (Phase 6).
create policy failures_insert on public.failures
  for insert to authenticated
  with check (
    private.can_manage_site(site_id)
    or (
      (select private.has_any_role('technician'))
      and source = 'MANUAL'
      and technician_id = (select auth.uid())
      and site_id in (select private.technician_site_ids())
      and (visit_id is null or private.can_edit_visit(visit_id))
    )
  );
create policy failures_manage_update on public.failures
  for update to authenticated
  using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
create policy failures_admin_delete on public.failures
  for delete to authenticated using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- corrective_actions (workflow rules enforced by private.guard_corrective_action)
-- -----------------------------------------------------------------------------
-- Evaluated on the row's own columns (not by id lookup) so INSERT ... RETURNING
-- works for the row being inserted.
create policy corrective_actions_select on public.corrective_actions
  for select to authenticated
  using (
    (select private.is_org_wide_reader())
    or site_id in (select private.scoped_site_ids())
    or ((select private.is_active_user())
        and (assigned_to = (select auth.uid())
             or created_by = (select auth.uid())
             or ((select private.has_any_role('technician'))
                 and visit_id in (select private.own_visit_ids()))))
  );
create policy corrective_actions_insert on public.corrective_actions
  for insert to authenticated
  with check (
    private.can_manage_site(site_id)
    or (
      (select private.has_any_role('technician'))
      and site_id in (select private.technician_site_ids())
      and (visit_id is null or private.can_edit_visit(visit_id))
      and (assigned_to is null or assigned_to = (select auth.uid()))
    )
  );
create policy corrective_actions_update on public.corrective_actions
  for update to authenticated
  using (private.can_manage_site(site_id) or assigned_to = (select auth.uid()))
  with check (private.can_manage_site(site_id) or assigned_to = (select auth.uid()));
create policy corrective_actions_admin_delete on public.corrective_actions
  for delete to authenticated using ((select private.is_admin()));

create policy corrective_action_updates_select on public.corrective_action_updates
  for select to authenticated
  using (private.can_read_corrective_action(corrective_action_id));
create policy corrective_action_updates_insert on public.corrective_action_updates
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.corrective_actions ca
       where ca.id = corrective_action_id
         and (ca.assigned_to = (select auth.uid()) or private.can_manage_site(ca.site_id))
    )
  );

-- -----------------------------------------------------------------------------
-- pm_photos
-- -----------------------------------------------------------------------------
create policy pm_photos_select on public.pm_photos
  for select to authenticated
  using (
    (select private.is_org_wide_reader())
    or (visit_id is not null and private.can_read_visit(visit_id))
    or (corrective_action_id is not null and private.can_read_corrective_action(corrective_action_id))
    or site_id in (select private.scoped_site_ids())
  );
create policy pm_photos_insert on public.pm_photos
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and (
      (visit_id is not null and private.can_edit_visit(visit_id))
      or (corrective_action_id is not null and exists (
            select 1 from public.corrective_actions ca
             where ca.id = corrective_action_id
               and (ca.assigned_to = (select auth.uid()) or private.can_manage_site(ca.site_id))))
      or (visit_id is null and corrective_action_id is null and private.can_manage_site(site_id))
    )
  );
create policy pm_photos_update on public.pm_photos
  for update to authenticated
  using (uploaded_by = (select auth.uid()) and (visit_id is null or private.can_edit_visit(visit_id)))
  with check (uploaded_by = (select auth.uid()) and (visit_id is null or private.can_edit_visit(visit_id)));
create policy pm_photos_delete on public.pm_photos
  for delete to authenticated
  using (
    (select private.is_admin())
    or (uploaded_by = (select auth.uid()) and visit_id is not null and private.can_edit_visit(visit_id))
  );

-- -----------------------------------------------------------------------------
-- notifications: recipients only
-- -----------------------------------------------------------------------------
create policy notifications_select on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));
create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy notifications_delete on public.notifications
  for delete to authenticated using (recipient_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- audit_logs: Super Admin read-only
-- -----------------------------------------------------------------------------
create policy audit_logs_admin_select on public.audit_logs
  for select to authenticated using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- site_documents / equipment / equipment_history
-- -----------------------------------------------------------------------------
create policy site_documents_select on public.site_documents
  for select to authenticated
  using ((select private.is_org_wide_reader()) or site_id in (select private.accessible_site_ids()));
create policy site_documents_manage_insert on public.site_documents
  for insert to authenticated with check (private.can_manage_site(site_id));
create policy site_documents_manage_update on public.site_documents
  for update to authenticated
  using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
create policy site_documents_manage_delete on public.site_documents
  for delete to authenticated using (private.can_manage_site(site_id));

create policy equipment_select on public.equipment
  for select to authenticated
  using ((select private.is_org_wide_reader()) or site_id in (select private.accessible_site_ids()));
create policy equipment_manage_insert on public.equipment
  for insert to authenticated with check (private.can_manage_site(site_id));
create policy equipment_manage_update on public.equipment
  for update to authenticated
  using (private.can_manage_site(site_id)) with check (private.can_manage_site(site_id));
create policy equipment_admin_delete on public.equipment
  for delete to authenticated using ((select private.is_admin()));

create policy equipment_history_select on public.equipment_history
  for select to authenticated
  using (equipment_id in (select e.id from public.equipment e));
create policy equipment_history_manage_insert on public.equipment_history
  for insert to authenticated
  with check (exists (select 1 from public.equipment e
                       where e.id = equipment_id and private.can_manage_site(e.site_id)));
create policy equipment_history_manage_update on public.equipment_history
  for update to authenticated
  using (exists (select 1 from public.equipment e
                  where e.id = equipment_id and private.can_manage_site(e.site_id)))
  with check (exists (select 1 from public.equipment e
                       where e.id = equipment_id and private.can_manage_site(e.site_id)));
create policy equipment_history_admin_delete on public.equipment_history
  for delete to authenticated using ((select private.is_admin()));

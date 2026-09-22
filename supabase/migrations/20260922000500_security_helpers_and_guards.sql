-- =============================================================================
-- Security helpers, auth hooks, admin RPCs and data-integrity guard triggers.
--
-- Access model
--   super_admin          : everything
--   viewer               : read-only, organisation-wide
--   regional_manager     : read-only, regions in user_region_scopes
--   regional_supervisor  : read + manage (assignments, schedules, PM review,
--                          failures, corrective actions) in scoped regions
--   technician           : actively assigned sites, own PM schedules/visits,
--                          own failures and corrective actions
--   maintenance          : corrective actions assigned to them (+ their sites)
--   inactive / no profile: nothing
--
-- All helpers are SECURITY DEFINER so they can read scope tables without
-- recursing into those tables' own RLS policies. They live in the `private`
-- schema, which is not exposed through the Data API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity helpers
-- -----------------------------------------------------------------------------
create or replace function private.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function private.has_any_role(variadic p_roles public.app_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = any (p_roles), false)
$$;

create or replace function private.is_active_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.current_app_role() is not null
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_any_role('super_admin')
$$;

-- Roles that may read everything in the organisation.
create or replace function private.is_org_wide_reader()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_any_role('super_admin', 'viewer')
$$;

-- -----------------------------------------------------------------------------
-- Scope helpers
-- -----------------------------------------------------------------------------
create or replace function private.scoped_region_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select s.region_id
    from public.user_region_scopes s
   where s.profile_id = auth.uid()
     and private.has_any_role('regional_manager', 'regional_supervisor')
$$;

-- Sites inside the caller's region scope (managers and supervisors only).
create or replace function private.scoped_site_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select st.id
    from public.sites st
   where st.region_id in (select private.scoped_region_ids())
$$;

-- Sites the caller (technician) is actively assigned to.
create or replace function private.technician_site_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select a.site_id
    from public.site_assignments a
   where a.technician_id = auth.uid()
     and a.is_active
     and a.starts_on <= current_date
     and (a.ends_on is null or a.ends_on >= current_date)
     and private.has_any_role('technician')
$$;

-- Every site the caller may read.
create or replace function private.accessible_site_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select st.id from public.sites st where private.is_org_wide_reader()
  union
  select private.scoped_site_ids()
  union
  select private.technician_site_ids()
  union
  select ca.site_id
    from public.corrective_actions ca
   where ca.assigned_to = auth.uid()
     and private.has_any_role('maintenance', 'technician')
$$;

-- Sites the caller may manage (write assignments, schedules, reviews, ...).
create or replace function private.can_manage_site(p_site_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_admin()
      or (private.has_any_role('regional_supervisor')
          and exists (select 1 from private.scoped_site_ids() x(id) where x.id = p_site_id))
$$;

create or replace function private.can_read_visit(p_visit_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.pm_visits v
     where v.id = p_visit_id
       and (
             private.is_org_wide_reader()
          or (v.technician_id = auth.uid() and private.has_any_role('technician'))
          or (private.has_any_role('regional_manager', 'regional_supervisor')
              and v.site_id in (select private.scoped_site_ids()))
          or (private.has_any_role('maintenance')
              and exists (select 1 from public.corrective_actions ca
                           where ca.visit_id = v.id and ca.assigned_to = auth.uid()))
       )
  )
$$;

-- Only the owning technician may change PM data, and only before submission
-- (or after rejection).
create or replace function private.can_edit_visit(p_visit_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.pm_visits v
     where v.id = p_visit_id
       and v.technician_id = auth.uid()
       and v.status in ('IN_PROGRESS', 'COMPLETED', 'REJECTED')
       and private.has_any_role('technician')
  )
$$;

create or replace function private.can_review_visit(p_site_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.can_manage_site(p_site_id)
$$;

create or replace function private.own_visit_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select v.id from public.pm_visits v
   where v.technician_id = auth.uid() and private.has_any_role('technician')
$$;

create or replace function private.can_read_corrective_action(p_action_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.corrective_actions ca
     where ca.id = p_action_id
       and (
             private.is_org_wide_reader()
          or ca.assigned_to = auth.uid()
          or ca.created_by = auth.uid()
          or (private.has_any_role('regional_manager', 'regional_supervisor')
              and ca.site_id in (select private.scoped_site_ids()))
          or (private.has_any_role('technician')
              and exists (select 1 from public.pm_visits v
                           where v.id = ca.visit_id and v.technician_id = auth.uid()))
       )
       and private.is_active_user()
  )
$$;

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
  -- technicians: their supervisor
  select t.supervisor_id from public.technicians t
   where t.id = auth.uid() and t.supervisor_id is not null
     and private.has_any_role('technician')
$$;

-- Safe text -> uuid conversion for storage path segments.
create or replace function private.try_uuid(p_value text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then p_value::uuid
  end
$$;

-- -----------------------------------------------------------------------------
-- Audit log writer (internal)
-- -----------------------------------------------------------------------------
create or replace function private.write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- Auth hook: create an (inactive) profile for every new auth user.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- One-time bootstrap of the first administrator. Run from the Supabase SQL
-- editor (database owner); not callable through the API.
create or replace function private.bootstrap_super_admin(p_email text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.profiles
     set role = 'super_admin', is_active = true
   where lower(email) = lower(p_email)
  returning id into v_id;
  if v_id is null then
    raise exception 'No profile found for %. Create the auth user first.', p_email;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'USER_ROLE_CHANGED', 'profile', v_id,
          jsonb_build_object('role', 'super_admin', 'via', 'bootstrap'));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- Called by the web and mobile apps right after a successful sign-in.
create or replace function public.record_login(p_client text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  update public.profiles set last_login_at = now() where id = auth.uid();
  perform private.write_audit_log('LOGIN', 'profile', auth.uid(),
    jsonb_build_object('client', left(coalesce(p_client, 'unknown'), 32)));
end;
$$;

-- Administrators change role / activation / home region through this RPC so
-- that role changes are always audited and never possible via direct UPDATE.
create or replace function public.admin_update_user(
  p_user_id uuid,
  p_role public.app_role,
  p_is_active boolean,
  p_region_id uuid default null
)
returns public.profiles
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before public.profiles;
  v_after  public.profiles;
begin
  if not private.is_admin() then
    raise exception 'Only a Super Admin can change user roles' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and (p_role <> 'super_admin' or not p_is_active) then
    raise exception 'You cannot remove your own Super Admin access' using errcode = '42501';
  end if;

  select * into v_before from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User % not found', p_user_id using errcode = 'P0002';
  end if;

  update public.profiles
     set role = p_role, is_active = p_is_active, region_id = p_region_id
   where id = p_user_id
  returning * into v_after;

  -- Keep role-detail rows in step with the role.
  if p_role = 'technician' then
    insert into public.technicians (id, region_id) values (p_user_id, p_region_id)
    on conflict (id) do update set is_active = true;
  else
    update public.technicians set is_active = false where id = p_user_id;
  end if;
  if p_role = 'regional_supervisor' then
    insert into public.supervisors (id) values (p_user_id)
    on conflict (id) do update set is_active = true;
  else
    update public.supervisors set is_active = false where id = p_user_id;
  end if;

  if v_before.role is distinct from v_after.role then
    perform private.write_audit_log('USER_ROLE_CHANGED', 'profile', p_user_id,
      jsonb_build_object('from', v_before.role, 'to', v_after.role));
  end if;
  if v_before.is_active is distinct from v_after.is_active then
    perform private.write_audit_log(
      case when v_after.is_active then 'USER_ACTIVATED' else 'USER_DEACTIVATED' end,
      'profile', p_user_id, '{}'::jsonb);
  end if;
  return v_after;
end;
$$;

-- -----------------------------------------------------------------------------
-- Guard: PM visit workflow and field immutability.
-- RLS decides WHO may update a row; this trigger decides WHAT they may change.
-- Server contexts without a JWT (migrations, service role) are trusted.
-- -----------------------------------------------------------------------------
create or replace function private.guard_pm_visit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_is_reviewer boolean;
  v_changed_forbidden text[];
  -- Columns a technician may never set or change.
  c_tech_forbidden text[] := array['technician_id', 'site_id', 'template_id', 'schedule_id',
    'supervisor_id', 'reviewed_by', 'reviewed_at', 'review_comments', 'created_by', 'created_at'];
  -- Columns a reviewer may change on someone else's visit.
  c_review_allowed text[] := array['status', 'review_comments', 'reviewed_by', 'reviewed_at',
    'supervisor_id', 'updated_at', 'updated_by'];
begin
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('IN_PROGRESS', 'COMPLETED', 'SUBMITTED') then
      raise exception 'A new PM visit must be IN_PROGRESS, COMPLETED or SUBMITTED' using errcode = '42501';
    end if;
    if new.reviewed_by is not null or new.reviewed_at is not null or new.review_comments is not null then
      raise exception 'Review fields cannot be set by the technician' using errcode = '42501';
    end if;
    if new.status = 'SUBMITTED' then
      new.submitted_at := now();
    end if;
    -- The reviewing supervisor is the site's supervisor, never client-chosen.
    new.supervisor_id := (select s.supervisor_id from public.sites s where s.id = new.site_id);
    return new;
  end if;

  v_is_owner := old.technician_id = v_uid and private.has_any_role('technician');
  v_is_reviewer := private.can_review_visit(old.site_id);

  if v_is_owner and not v_is_reviewer then
    if old.status not in ('IN_PROGRESS', 'COMPLETED', 'REJECTED') then
      raise exception 'PM visit is locked (status %). It can only be changed after rejection.', old.status
        using errcode = '42501';
    end if;
    if new.status not in ('IN_PROGRESS', 'COMPLETED', 'SUBMITTED') then
      raise exception 'Technicians cannot set PM status to %', new.status using errcode = '42501';
    end if;
    select array_agg(k) into v_changed_forbidden
      from unnest(c_tech_forbidden) k
     where (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k);
    if v_changed_forbidden is not null then
      raise exception 'Technicians cannot change: %', array_to_string(v_changed_forbidden, ', ')
        using errcode = '42501';
    end if;
    if new.status = 'SUBMITTED' and old.status <> 'SUBMITTED' then
      new.submitted_at := now();
      -- A resubmission after rejection clears the previous review outcome timestamps.
      new.reviewed_at := null;
      new.reviewed_by := null;
    end if;
    return new;
  end if;

  if v_is_reviewer then
    if (to_jsonb(new) - c_review_allowed) is distinct from (to_jsonb(old) - c_review_allowed)
       and not private.is_admin() then
      raise exception 'Supervisors may only change review fields on a PM visit' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if new.status in ('APPROVED', 'REJECTED') then
        if old.status <> 'SUBMITTED' then
          raise exception 'Only a SUBMITTED PM can be approved or rejected (current: %)', old.status
            using errcode = '42501';
        end if;
        if new.status = 'REJECTED' and coalesce(btrim(new.review_comments), '') = '' then
          raise exception 'A rejection reason is required' using errcode = '23514';
        end if;
        new.reviewed_by := v_uid;
        new.reviewed_at := now();
      elsif new.status = 'CANCELLED' then
        if old.status in ('APPROVED', 'SUBMITTED') and not private.is_admin() then
          raise exception 'Only a Super Admin can cancel a submitted or approved PM' using errcode = '42501';
        end if;
      elsif not private.is_admin() then
        raise exception 'Supervisors cannot set PM status to %', new.status using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  raise exception 'Not permitted to modify this PM visit' using errcode = '42501';
end;
$$;

create trigger guard_pm_visit
  before insert or update on public.pm_visits
  for each row execute function private.guard_pm_visit();

-- -----------------------------------------------------------------------------
-- Response / reading integrity: snapshot prompt text, evaluate the configured
-- failure rule server-side (clients cannot mark or unmark failures), and make
-- sure the item belongs to the visit's template.
-- -----------------------------------------------------------------------------
create or replace function private.prepare_pm_response()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item public.pm_checklist_items;
  v_template_id uuid;
begin
  select i.* into v_item from public.pm_checklist_items i where i.id = new.checklist_item_id;
  select s.template_id into v_template_id from public.pm_sections s where s.id = v_item.section_id;

  if v_template_id is distinct from (select v.template_id from public.pm_visits v where v.id = new.visit_id) then
    raise exception 'Checklist item does not belong to this PM visit''s template' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or new.checklist_item_id is distinct from old.checklist_item_id then
    new.prompt_snapshot := v_item.prompt;
    new.unit_snapshot := v_item.unit;
  else
    new.prompt_snapshot := old.prompt_snapshot;
    new.unit_snapshot := old.unit_snapshot;
  end if;

  if new.answer = 'N/A' and not v_item.allow_not_applicable then
    raise exception 'N/A is not allowed for "%"', v_item.prompt using errcode = '23514';
  end if;

  new.is_failure := (new.answer = 'NO'  and v_item.creates_failure_on_no)
                 or (new.answer = 'YES' and v_item.creates_failure_on_yes);
  new.answered_by := coalesce(auth.uid(), new.answered_by);
  return new;
end;
$$;

create trigger prepare_pm_response
  before insert or update on public.pm_responses
  for each row execute function private.prepare_pm_response();

create or replace function private.prepare_pm_reading()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_field public.pm_reading_fields;
  v_template_id uuid;
begin
  select f.* into v_field from public.pm_reading_fields f where f.id = new.reading_field_id;
  select s.template_id into v_template_id from public.pm_sections s where s.id = v_field.section_id;

  if v_template_id is distinct from (select v.template_id from public.pm_visits v where v.id = new.visit_id) then
    raise exception 'Reading field does not belong to this PM visit''s template' using errcode = '23514';
  end if;

  new.label_snapshot := v_field.label;
  new.unit_snapshot := v_field.unit;
  return new;
end;
$$;

create trigger prepare_pm_reading
  before insert or update on public.pm_readings
  for each row execute function private.prepare_pm_reading();

-- -----------------------------------------------------------------------------
-- Photos: derive site_id from the photo's context so a client can never file
-- evidence against a site it did not visit.
-- -----------------------------------------------------------------------------
create or replace function private.prepare_pm_photo()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.visit_id is not null then
    select v.site_id into new.site_id from public.pm_visits v where v.id = new.visit_id;
  elsif new.corrective_action_id is not null then
    select ca.site_id into new.site_id from public.corrective_actions ca where ca.id = new.corrective_action_id;
  elsif new.failure_id is not null then
    select f.site_id into new.site_id from public.failures f where f.id = new.failure_id;
  end if;
  if tg_op = 'UPDATE' then
    new.uploaded_by := old.uploaded_by;
    new.file_path := old.file_path;
    new.bucket := old.bucket;
  end if;
  return new;
end;
$$;

create trigger prepare_pm_photo
  before insert or update on public.pm_photos
  for each row execute function private.prepare_pm_photo();

-- -----------------------------------------------------------------------------
-- Guard: corrective action workflow.
--   OPEN -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> VERIFIED -> CLOSED
-- Assignees may progress their own work up to COMPLETED; verification and
-- closure belong to supervisors / admins.
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so the automatic timeline entry is written regardless of
-- the caller's insert rights on corrective_action_updates.
create or replace function private.guard_corrective_action()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_manager boolean;
  c_assignee_allowed text[] := array['status', 'resolution', 'completed_at', 'client_updated_at',
    'updated_at', 'updated_by'];
  c_order public.corrective_action_status[] :=
    array['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];
begin
  if v_uid is null then
    return new;
  end if;

  v_is_manager := private.can_manage_site(coalesce(new.site_id, old.site_id));

  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      new.assigned_by := v_uid;
      new.assigned_at := now();
      if new.status = 'OPEN' then
        new.status := 'ASSIGNED';
      end if;
    end if;
    if not v_is_manager and new.status not in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED') then
      raise exception 'Only supervisors can create a % corrective action', new.status using errcode = '42501';
    end if;
    if new.status = 'COMPLETED' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    return new;
  end if;

  if not v_is_manager then
    if old.assigned_to is distinct from v_uid then
      raise exception 'Only the assignee or a supervisor can update this corrective action' using errcode = '42501';
    end if;
    if (to_jsonb(new) - c_assignee_allowed) is distinct from (to_jsonb(old) - c_assignee_allowed) then
      raise exception 'Assignees may only change status and resolution' using errcode = '42501';
    end if;
    if new.status in ('VERIFIED', 'CLOSED', 'OPEN') and new.status is distinct from old.status then
      raise exception 'Assignees cannot set status to %', new.status using errcode = '42501';
    end if;
    if array_position(c_order, new.status) < array_position(c_order, old.status) then
      raise exception 'Corrective action status cannot move backwards (% -> %)', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_by := v_uid;
    new.assigned_at := now();
    if new.assigned_to is not null and new.status = 'OPEN' then
      new.status := 'ASSIGNED';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'COMPLETED' then
      if coalesce(btrim(new.resolution), '') = '' then
        raise exception 'A resolution note is required to complete a corrective action' using errcode = '23514';
      end if;
      new.completed_at := coalesce(new.completed_at, now());
    elsif new.status = 'VERIFIED' then
      new.verified_by := v_uid;
      new.verified_at := now();
    elsif new.status = 'CLOSED' then
      new.closed_at := now();
    end if;
    insert into public.corrective_action_updates (corrective_action_id, author_id, from_status, to_status)
    values (new.id, v_uid, old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger guard_corrective_action
  before insert or update on public.corrective_actions
  for each row execute function private.guard_corrective_action();

-- -----------------------------------------------------------------------------
-- Audit triggers for configuration / organisational changes.
-- -----------------------------------------------------------------------------
create or replace function private.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text := tg_argv[0];
  v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then (to_jsonb(old) ->> 'id')::uuid else (to_jsonb(new) ->> 'id')::uuid end;
  perform private.write_audit_log(
    v_action || '_' || tg_op,
    tg_table_name,
    v_id,
    case when tg_op = 'UPDATE'
      then jsonb_build_object('changed', (
        select coalesce(jsonb_agg(n.key), '[]'::jsonb)
          from jsonb_each(to_jsonb(new)) n
         where n.value is distinct from (to_jsonb(old) -> n.key)
           and n.key not in ('updated_at', 'updated_by')))
      else '{}'::jsonb end
  );
  return null;
end;
$$;

create trigger audit_sites after insert or update or delete on public.sites
  for each row execute function private.audit_row_change('SITE');
create trigger audit_checklist_items after insert or update or delete on public.pm_checklist_items
  for each row execute function private.audit_row_change('CHECKLIST_ITEM');
create trigger audit_sections after insert or update or delete on public.pm_sections
  for each row execute function private.audit_row_change('PM_SECTION');
create trigger audit_reading_fields after insert or update or delete on public.pm_reading_fields
  for each row execute function private.audit_row_change('READING_FIELD');
create trigger audit_templates after insert or update or delete on public.pm_templates
  for each row execute function private.audit_row_change('PM_TEMPLATE');
create trigger audit_site_assignments after insert or update or delete on public.site_assignments
  for each row execute function private.audit_row_change('SITE_ASSIGNMENT');
create trigger audit_system_settings after insert or update on public.system_settings
  for each row execute function private.audit_row_change('SYSTEM_SETTING');

-- Status transitions on PM visits.
create or replace function private.audit_pm_visit_status()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit_log('PM_STARTED', 'pm_visit', new.id,
      jsonb_build_object('site_id', new.site_id, 'status', new.status));
    if new.status = 'SUBMITTED' then
      perform private.write_audit_log('PM_SUBMITTED', 'pm_visit', new.id, jsonb_build_object('site_id', new.site_id));
    end if;
  elsif new.status is distinct from old.status then
    perform private.write_audit_log(
      case new.status
        when 'SUBMITTED' then 'PM_SUBMITTED'
        when 'APPROVED'  then 'PM_APPROVED'
        when 'REJECTED'  then 'PM_REJECTED'
        else 'PM_STATUS_CHANGED' end,
      'pm_visit', new.id,
      jsonb_build_object('site_id', new.site_id, 'from', old.status, 'to', new.status));
  end if;
  return null;
end;
$$;

create trigger audit_pm_visit_status after insert or update of status on public.pm_visits
  for each row execute function private.audit_pm_visit_status();

-- -----------------------------------------------------------------------------
-- Lock down function execution.
-- -----------------------------------------------------------------------------
revoke execute on function private.bootstrap_super_admin(text) from public, authenticated;
revoke execute on function private.handle_new_auth_user() from public, authenticated;
revoke execute on function private.write_audit_log(text, text, uuid, jsonb) from public, authenticated;
revoke execute on function public.record_login(text) from public, anon;
revoke execute on function public.admin_update_user(uuid, public.app_role, boolean, uuid) from public, anon;
grant execute on function public.record_login(text) to authenticated;
grant execute on function public.admin_update_user(uuid, public.app_role, boolean, uuid) to authenticated;

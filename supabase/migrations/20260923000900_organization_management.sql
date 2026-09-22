-- =============================================================================
-- Phase 2: organisation management
--   * integrity checks for assignments / supervisors
--   * audited admin RPC for region scopes
--   * audit triggers for organisational tables
--   * RLS-respecting overview views (security_invoker) for list pages
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Integrity: only active technicians can hold active site assignments.
-- -----------------------------------------------------------------------------
create or replace function private.check_site_assignment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.is_active and not exists (
    select 1
      from public.technicians t
      join public.profiles p on p.id = t.id
     where t.id = new.technician_id
       and t.is_active and p.is_active and p.role = 'technician'
  ) then
    raise exception 'Only active technicians can be assigned to sites' using errcode = '23514';
  end if;
  if new.ends_on is not null and new.ends_on < current_date then
    new.is_active := false;
  end if;
  return new;
end;
$$;

create trigger check_site_assignment
  before insert or update on public.site_assignments
  for each row execute function private.check_site_assignment();

-- Integrity: a site's / technician's supervisor must be an active supervisor.
create or replace function private.check_supervisor_reference()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.supervisor_id is not null
     and (tg_op = 'INSERT' or new.supervisor_id is distinct from old.supervisor_id)
     and not exists (
       select 1
         from public.supervisors s
         join public.profiles p on p.id = s.id
        where s.id = new.supervisor_id
          and s.is_active and p.is_active and p.role = 'regional_supervisor'
     ) then
    raise exception 'Supervisor must be an active Regional Supervisor' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_site_supervisor
  before insert or update of supervisor_id on public.sites
  for each row execute function private.check_supervisor_reference();
create trigger check_technician_supervisor
  before insert or update of supervisor_id on public.technicians
  for each row execute function private.check_supervisor_reference();

-- -----------------------------------------------------------------------------
-- Admin RPC: replace a manager's / supervisor's region scope atomically.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_region_scopes(p_user_id uuid, p_region_ids uuid[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_before uuid[];
  v_after uuid[] := coalesce(array(select distinct unnest(p_region_ids) order by 1), '{}');
begin
  if not private.is_admin() then
    raise exception 'Only a Super Admin can change region scopes' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_user_id;
  if v_role is null then
    raise exception 'User % not found', p_user_id using errcode = 'P0002';
  end if;
  if cardinality(v_after) > 0 and v_role not in ('regional_manager', 'regional_supervisor') then
    raise exception 'Region scopes apply only to Regional Managers and Regional Supervisors' using errcode = '23514';
  end if;

  select coalesce(array_agg(region_id order by region_id), '{}') into v_before
    from public.user_region_scopes where profile_id = p_user_id;

  delete from public.user_region_scopes
   where profile_id = p_user_id and not (region_id = any (v_after));
  insert into public.user_region_scopes (profile_id, region_id, created_by)
  select p_user_id, r, auth.uid() from unnest(v_after) r
  on conflict do nothing;

  if v_before is distinct from v_after then
    perform private.write_audit_log('USER_SCOPE_CHANGED', 'profile', p_user_id,
      jsonb_build_object('from', to_jsonb(v_before), 'to', to_jsonb(v_after)));
  end if;
end;
$$;

revoke execute on function public.admin_set_region_scopes(uuid, uuid[]) from public, anon;
grant execute on function public.admin_set_region_scopes(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Audit organisational changes (sites were already audited in Phase 1).
-- -----------------------------------------------------------------------------
create trigger audit_regions after insert or update or delete on public.regions
  for each row execute function private.audit_row_change('REGION');
create trigger audit_clusters after insert or update or delete on public.clusters
  for each row execute function private.audit_row_change('CLUSTER');
create trigger audit_counties after insert or update or delete on public.counties
  for each row execute function private.audit_row_change('COUNTY');
create trigger audit_technicians after insert or update or delete on public.technicians
  for each row execute function private.audit_row_change('TECHNICIAN');
create trigger audit_supervisors after insert or update or delete on public.supervisors
  for each row execute function private.audit_row_change('SUPERVISOR');

-- -----------------------------------------------------------------------------
-- Overview views. security_invoker = true: every underlying table is read with
-- the caller's RLS, so counts and names only reflect what the caller may see.
-- -----------------------------------------------------------------------------
create view public.site_overview
with (security_invoker = true) as
select
  s.id,
  s.site_code,
  s.site_name,
  s.status,
  s.is_demo,
  s.site_type,
  s.power_configuration,
  s.generator_available,
  s.solar_available,
  s.battery_available,
  s.grid_available,
  s.latitude,
  s.longitude,
  s.address,
  s.geofence_radius_m,
  s.region_id,
  r.name as region_name,
  s.cluster_id,
  cl.name as cluster_name,
  s.county_id,
  co.name as county_name,
  s.supervisor_id,
  sp.full_name as supervisor_name,
  ( select string_agg(p.full_name, ', ' order by p.full_name)
      from public.site_assignments a
      join public.profiles p on p.id = a.technician_id
     where a.site_id = s.id and a.is_active and (a.ends_on is null or a.ends_on >= current_date)
  ) as technician_names,
  ( select max(coalesce(v.ended_at, v.submitted_at, v.started_at))
      from public.pm_visits v
     where v.site_id = s.id and v.status in ('COMPLETED', 'SUBMITTED', 'APPROVED')
  ) as last_pm_at,
  ( select ps.due_date
      from public.pm_schedules ps
     where ps.site_id = s.id and ps.status in ('SCHEDULED', 'IN_PROGRESS', 'OVERDUE', 'REJECTED')
     order by ps.due_date
     limit 1
  ) as next_pm_due,
  ( select ps.status
      from public.pm_schedules ps
     where ps.site_id = s.id and ps.status in ('SCHEDULED', 'IN_PROGRESS', 'OVERDUE', 'REJECTED')
     order by ps.due_date
     limit 1
  ) as next_pm_status,
  ( select count(*)::int
      from public.failures f
     where f.site_id = s.id and f.status not in ('VERIFIED', 'CLOSED')
  ) as open_failures,
  ( select count(*)::int
      from public.corrective_actions ca
     where ca.site_id = s.id and ca.status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
  ) as open_corrective_actions,
  s.created_at,
  s.updated_at
from public.sites s
join public.regions r on r.id = s.region_id
left join public.clusters cl on cl.id = s.cluster_id
left join public.counties co on co.id = s.county_id
left join public.profiles sp on sp.id = s.supervisor_id;

create view public.technician_overview
with (security_invoker = true) as
select
  t.id,
  p.full_name,
  p.email,
  p.phone,
  t.employee_code,
  (t.is_active and p.is_active and p.role = 'technician') as is_active,
  t.region_id,
  r.name as region_name,
  t.supervisor_id,
  sp.full_name as supervisor_name,
  ( select count(*)::int
      from public.site_assignments a
     where a.technician_id = t.id and a.is_active and (a.ends_on is null or a.ends_on >= current_date)
  ) as assigned_sites,
  ( select count(*)::int
      from public.pm_schedules ps
     where ps.technician_id = t.id and ps.status in ('SCHEDULED', 'IN_PROGRESS', 'OVERDUE', 'REJECTED')
  ) as open_pm,
  ( select count(*)::int
      from public.pm_schedules ps
     where ps.technician_id = t.id
       and (ps.status = 'OVERDUE'
            or (ps.status in ('SCHEDULED', 'IN_PROGRESS', 'REJECTED') and ps.due_date < current_date))
  ) as overdue_pm
from public.technicians t
join public.profiles p on p.id = t.id
left join public.regions r on r.id = t.region_id
left join public.profiles sp on sp.id = t.supervisor_id;

create view public.supervisor_overview
with (security_invoker = true) as
select
  s.id,
  p.full_name,
  p.email,
  p.phone,
  s.employee_code,
  (s.is_active and p.is_active and p.role = 'regional_supervisor') as is_active,
  ( select string_agg(r.name, ', ' order by r.name)
      from public.user_region_scopes u
      join public.regions r on r.id = u.region_id
     where u.profile_id = s.id
  ) as region_names,
  ( select string_agg(distinct co.name, ', ')
      from public.sites st
      join public.counties co on co.id = st.county_id
     where st.supervisor_id = s.id
  ) as county_names,
  (select count(*)::int from public.sites st where st.supervisor_id = s.id) as site_count,
  (select count(*)::int from public.technicians t where t.supervisor_id = s.id and t.is_active) as technician_count
from public.supervisors s
join public.profiles p on p.id = s.id;

revoke all on public.site_overview, public.technician_overview, public.supervisor_overview from anon;
grant select on public.site_overview, public.technician_overview, public.supervisor_overview to authenticated;

-- -----------------------------------------------------------------------------
-- Audit: report / export generated (called by the web app after an export).
-- -----------------------------------------------------------------------------
create or replace function public.record_report_generated(
  p_report text,
  p_filters jsonb default '{}'::jsonb,
  p_row_count integer default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.write_audit_log('REPORT_GENERATED', 'report', null,
    jsonb_build_object('report', left(p_report, 64), 'filters', coalesce(p_filters, '{}'::jsonb), 'rows', p_row_count));
end;
$$;

revoke execute on function public.record_report_generated(text, jsonb, integer) from public, anon;
grant execute on function public.record_report_generated(text, jsonb, integer) to authenticated;

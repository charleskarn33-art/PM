-- =============================================================================
-- Phase 7: analytics.
--
-- Every function is SECURITY INVOKER: rows are read under the caller's RLS,
-- so a supervisor's or manager's figures cover only their regions, exactly
-- like the lists they see. Only submitted/approved PMs count as recorded
-- readings; nothing is estimated or extrapolated.
-- =============================================================================

-- Completed = submitted for review or approved (the technician's work is done).
create or replace function private.pm_done(p_status public.pm_status)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_status in ('COMPLETED', 'SUBMITTED', 'APPROVED')
$$;

-- -----------------------------------------------------------------------------
-- PM compliance for schedules DUE in [p_from, p_to], grouped by
-- region | county | technician | supervisor | month.
--   scheduled: due in the period (cancelled excluded)
--   completed: done (submitted / approved)
--   on_time:   done, submitted on or before the due date
--   overdue:   not done and past due
-- -----------------------------------------------------------------------------
create or replace function public.analytics_pm_compliance(
  p_from date,
  p_to date,
  p_group text,
  p_region uuid default null
)
returns table (group_key text, group_label text, scheduled integer, completed integer, on_time integer, overdue integer)
language sql stable security invoker
set search_path = ''
as $$
  with s as (
    select ps.*, st.region_id, st.county_id, st.supervisor_id as site_supervisor_id,
           (select v.submitted_at from public.pm_visits v
             where v.schedule_id = ps.id and v.status in ('SUBMITTED', 'APPROVED')
             order by v.submitted_at limit 1) as submitted_at
      from public.pm_schedules ps
      join public.sites st on st.id = ps.site_id
     where ps.due_date between p_from and p_to
       and ps.status <> 'CANCELLED'
       and (p_region is null or st.region_id = p_region)
  ),
  g as (
    select
      case p_group
        when 'region' then s.region_id::text
        when 'county' then s.county_id::text
        when 'technician' then s.technician_id::text
        when 'supervisor' then s.site_supervisor_id::text
        when 'month' then to_char(date_trunc('month', s.due_date), 'YYYY-MM')
      end as k,
      s.*
    from s
  )
  select
    g.k,
    case p_group
      when 'region' then coalesce((select r.name from public.regions r where r.id::text = g.k), 'No region')
      when 'county' then coalesce((select c.name from public.counties c where c.id::text = g.k), 'No county')
      when 'technician' then coalesce((select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id::text = g.k), 'Unassigned')
      when 'supervisor' then coalesce((select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id::text = g.k), 'No supervisor')
      else g.k
    end,
    count(*)::int,
    count(*) filter (where private.pm_done(g.status))::int,
    count(*) filter (where private.pm_done(g.status) and g.submitted_at::date <= g.due_date)::int,
    count(*) filter (where not private.pm_done(g.status) and (g.status = 'OVERDUE' or g.due_date < current_date))::int
  from g
  where p_group in ('region', 'county', 'technician', 'supervisor', 'month')
  group by g.k
  order by 2
$$;

-- -----------------------------------------------------------------------------
-- Failures DETECTED in [p_from, p_to], grouped by category | severity | month
-- | item | site. Resolution time = detected → resolved (hours), for resolved ones.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_failures(
  p_from date,
  p_to date,
  p_group text,
  p_region uuid default null
)
returns table (group_key text, group_label text, total integer, open integer, critical integer, avg_resolution_hours numeric)
language sql stable security invoker
set search_path = ''
as $$
  with f as (
    select f.*, st.site_code, st.site_name, i.prompt
      from public.failures f
      join public.sites st on st.id = f.site_id
      left join public.pm_checklist_items i on i.id = f.checklist_item_id
     where f.detected_at >= p_from and f.detected_at < p_to + 1
       and (p_region is null or st.region_id = p_region)
  )
  select
    case p_group
      when 'category' then f.category::text
      when 'severity' then f.severity::text
      when 'month' then to_char(date_trunc('month', f.detected_at), 'YYYY-MM')
      when 'item' then coalesce(f.prompt, 'Reported manually')
      when 'site' then f.site_id::text
    end as k,
    min(case p_group
      when 'site' then f.site_code || ' ' || f.site_name
      when 'item' then coalesce(f.prompt, 'Reported manually')
      else null end),
    count(*)::int,
    count(*) filter (where f.status not in ('VERIFIED', 'CLOSED'))::int,
    count(*) filter (where f.severity = 'CRITICAL')::int,
    round((avg(extract(epoch from (f.resolved_at - f.detected_at)) / 3600) filter (where f.resolved_at is not null))::numeric, 1)
  from f
  where p_group in ('category', 'severity', 'month', 'item', 'site')
  group by 1
  order by 3 desc, 1
$$;

-- -----------------------------------------------------------------------------
-- Technician performance for work in [p_from, p_to].
-- -----------------------------------------------------------------------------
create or replace function public.analytics_technicians(
  p_from date,
  p_to date,
  p_region uuid default null
)
returns table (
  technician_id uuid, technician_name text, region_name text,
  pm_submitted integer, pm_approved integer, pm_returned integer, pm_awaiting_review integer,
  avg_pm_minutes numeric, failures_reported integer,
  actions_assigned integer, actions_completed integer, actions_overdue integer
)
language sql stable security invoker
set search_path = ''
as $$
  with t as (
    select p.id, coalesce(nullif(p.full_name, ''), p.email) as name, r.name as region_name, p.region_id
      from public.technicians tc
      join public.profiles p on p.id = tc.id
      left join public.regions r on r.id = tc.region_id
     where p.is_active and (p_region is null or tc.region_id = p_region)
  ),
  v as (
    select v.* from public.pm_visits v
     where v.submitted_at >= p_from and v.submitted_at < p_to + 1
  )
  select
    t.id, t.name, t.region_name,
    (select count(*)::int from v where v.technician_id = t.id),
    (select count(*)::int from v where v.technician_id = t.id and v.status = 'APPROVED'),
    (select count(*)::int from v where v.technician_id = t.id and v.status = 'REJECTED'),
    (select count(*)::int from v where v.technician_id = t.id and v.status = 'SUBMITTED'),
    (select round(avg(extract(epoch from (v.ended_at - v.started_at)) / 60)::numeric, 0)
       from v where v.technician_id = t.id and v.ended_at is not null and v.started_at is not null),
    (select count(*)::int from public.failures f
      where f.technician_id = t.id and f.detected_at >= p_from and f.detected_at < p_to + 1),
    (select count(*)::int from public.corrective_actions ca
      where ca.assigned_to = t.id and ca.assigned_at >= p_from and ca.assigned_at < p_to + 1),
    (select count(*)::int from public.corrective_actions ca
      where ca.assigned_to = t.id and ca.completed_at >= p_from and ca.completed_at < p_to + 1),
    (select count(*)::int from public.corrective_actions ca
      where ca.assigned_to = t.id and ca.status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS') and ca.due_date < current_date)
  from t
  order by t.name
$$;

-- -----------------------------------------------------------------------------
-- Latest recorded equipment readings per site (from submitted or approved PMs):
-- DC load and phases, generator, battery, solar, earthing.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_latest_readings(p_region uuid default null)
returns table (
  site_id uuid, site_code text, site_name text, region_name text, is_demo boolean,
  dc_recorded_at timestamptz, rectifier_voltage_v numeric, load_current_a numeric, dc_power_kw numeric,
  dc_modules_installed integer, dc_modules_operational integer,
  phase_count integer, phase_min_a numeric, phase_max_a numeric, phase_total_a numeric,
  gen_recorded_at timestamptz, running_hours numeric, fuel_level_pct numeric, oil_pressure_bar numeric,
  generator_kva numeric, generator_requires_service boolean,
  battery_recorded_at timestamptz, battery_voltage_v numeric, battery_capacity_ah numeric, battery_string_count integer,
  battery_damage boolean, battery_water_top_up boolean,
  solar_recorded_at timestamptz, panels_installed integer, panels_operational integer, damaged_panel_count integer,
  solar_operating_normally boolean,
  earthing_recorded_at timestamptz, earthing_abnormalities boolean
)
language sql stable security invoker
set search_path = ''
as $$
  with done as (
    select v.id from public.pm_visits v where v.status in ('SUBMITTED', 'APPROVED')
  ),
  dc as (
    select distinct on (d.site_id) d.* from public.dc_readings d
     where d.visit_id in (select id from done) order by d.site_id, d.recorded_at desc
  ),
  ph as (
    select p.visit_id, count(p.amp_value)::int as n, min(p.amp_value) as mn, max(p.amp_value) as mx, sum(p.amp_value) as total
      from public.dc_phase_currents p where p.visit_id in (select visit_id from dc) group by p.visit_id
  ),
  gen as (
    select distinct on (g.site_id) g.* from public.generator_readings g
     where g.visit_id in (select id from done) order by g.site_id, g.recorded_at desc
  ),
  bat as (
    select distinct on (b.site_id) b.* from public.battery_readings b
     where b.visit_id in (select id from done) order by b.site_id, b.recorded_at desc
  ),
  sol as (
    select distinct on (s.site_id) s.* from public.solar_readings s
     where s.visit_id in (select id from done) order by s.site_id, s.recorded_at desc
  ),
  ea as (
    select distinct on (e.site_id) e.* from public.earthing_readings e
     where e.visit_id in (select id from done) order by e.site_id, e.recorded_at desc
  )
  select st.id, st.site_code, st.site_name, r.name, st.is_demo,
         dc.recorded_at, dc.rectifier_voltage_v, dc.load_current_a, dc.dc_power_kw,
         dc.dc_modules_installed, dc.dc_modules_operational,
         ph.n, ph.mn, ph.mx, ph.total,
         gen.recorded_at, gen.running_hours, gen.fuel_level_pct, gen.oil_pressure_bar, gen.generator_kva, gen.requires_service,
         bat.recorded_at, bat.battery_voltage_v, bat.capacity_ah, bat.string_count, bat.physical_damage_found, bat.water_top_up_required,
         sol.recorded_at, sol.panels_installed, sol.panels_operational, sol.damaged_panel_count, sol.system_operating_normally,
         ea.recorded_at, ea.abnormalities_found
    from public.sites st
    left join public.regions r on r.id = st.region_id
    left join dc on dc.site_id = st.id
    left join ph on ph.visit_id = dc.visit_id
    left join gen on gen.site_id = st.id
    left join bat on bat.site_id = st.id
    left join sol on sol.site_id = st.id
    left join ea on ea.site_id = st.id
   where (p_region is null or st.region_id = p_region)
     and coalesce(dc.site_id, gen.site_id, bat.site_id, sol.site_id, ea.site_id) is not null
   order by st.site_code
$$;

revoke execute on function public.analytics_pm_compliance(date, date, text, uuid) from public, anon;
revoke execute on function public.analytics_failures(date, date, text, uuid) from public, anon;
revoke execute on function public.analytics_technicians(date, date, uuid) from public, anon;
revoke execute on function public.analytics_latest_readings(uuid) from public, anon;
grant execute on function public.analytics_pm_compliance(date, date, text, uuid) to authenticated;
grant execute on function public.analytics_failures(date, date, text, uuid) to authenticated;
grant execute on function public.analytics_technicians(date, date, uuid) to authenticated;
grant execute on function public.analytics_latest_readings(uuid) to authenticated;

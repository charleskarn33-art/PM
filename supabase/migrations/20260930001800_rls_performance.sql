-- =============================================================================
-- Phase 9 performance: set-based RLS for large tables.
--
-- Several SELECT policies called private.can_read_visit(visit_id) or
-- private.can_read_corrective_action(id) — functions that run a query for
-- EACH ROW. On a two-year, 1,200-site data set a supervisor's PM visit list
-- took 16 s (the check ran for every visit outside their region). The same
-- rules are now expressed as sets computed once per query:
--   visit_id IN (SELECT private.readable_visit_ids())
-- Who may read what is unchanged (the RLS tests cover every role).
-- =============================================================================

-- Visits the caller may read through their role (org-wide readers are
-- handled by each policy's first clause and are not listed here).
create or replace function private.readable_visit_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select v.id from public.pm_visits v
   where private.has_any_role('technician') and v.technician_id = auth.uid()
  union
  select v.id from public.pm_visits v
   where private.has_any_role('regional_manager', 'regional_supervisor')
     and v.site_id in (select private.scoped_site_ids())
  union
  select ca.visit_id from public.corrective_actions ca
   where private.has_any_role('maintenance') and ca.assigned_to = auth.uid() and ca.visit_id is not null
$$;

-- Visits a Maintenance user may read: those of the corrective actions assigned to them.
create or replace function private.maintenance_visit_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select ca.visit_id from public.corrective_actions ca
   where private.has_any_role('maintenance') and ca.assigned_to = auth.uid() and ca.visit_id is not null
$$;

-- Corrective actions the caller may read (same rule as can_read_corrective_action).
-- One branch per rule so each role check runs once, not once per row.
create or replace function private.readable_action_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select x.id from (
    select ca.id from public.corrective_actions ca where private.is_org_wide_reader()
    union
    select ca.id from public.corrective_actions ca where ca.assigned_to = auth.uid()
    union
    select ca.id from public.corrective_actions ca where ca.created_by = auth.uid()
    union
    select ca.id from public.corrective_actions ca
     where private.has_any_role('regional_manager', 'regional_supervisor')
       and ca.site_id in (select private.scoped_site_ids())
    union
    select ca.id from public.corrective_actions ca
     where private.has_any_role('technician') and ca.visit_id in (select private.own_visit_ids())
  ) x
  where private.is_active_user()
$$;

-- pm_visits: the other clauses already cover org-wide readers, the technician
-- and the region; the per-row check only added Maintenance access.
drop policy pm_visits_select on public.pm_visits;
create policy pm_visits_select on public.pm_visits
  for select to authenticated
  using (
    (select private.is_org_wide_reader())
    or (technician_id = (select auth.uid()) and (select private.has_any_role('technician')))
    or site_id in (select private.scoped_site_ids())
    or id in (select private.maintenance_visit_ids())
  );

drop policy pm_responses_select on public.pm_responses;
create policy pm_responses_select on public.pm_responses
  for select to authenticated
  using ((select private.is_org_wide_reader()) or visit_id in (select private.readable_visit_ids()));

drop policy pm_readings_select on public.pm_readings;
create policy pm_readings_select on public.pm_readings
  for select to authenticated
  using ((select private.is_org_wide_reader()) or visit_id in (select private.readable_visit_ids()));

-- Analytics projections (one row per visit or per phase).
do $$
declare
  t text;
begin
  foreach t in array array['generator_readings', 'dc_readings', 'dc_phase_currents', 'battery_readings', 'solar_readings', 'earthing_readings'] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         (select private.is_org_wide_reader())
         or site_id in (select private.scoped_site_ids())
         or visit_id in (select private.readable_visit_ids()))',
      t || '_select', t);
  end loop;
end;
$$;

drop policy pm_photos_select on public.pm_photos;
create policy pm_photos_select on public.pm_photos
  for select to authenticated
  using (
    (select private.is_org_wide_reader())
    or site_id in (select private.scoped_site_ids())
    or visit_id in (select private.readable_visit_ids())
    or corrective_action_id in (select private.readable_action_ids())
  );

drop policy corrective_action_updates_select on public.corrective_action_updates;
create policy corrective_action_updates_select on public.corrective_action_updates
  for select to authenticated
  using (corrective_action_id in (select private.readable_action_ids()));

-- -----------------------------------------------------------------------------
-- analytics_technicians: same figures, computed with one grouped pass per
-- table instead of seven correlated sub-queries per technician (0.9 s for 100
-- technicians on the perf data set; this grew with technicians × PMs).
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
    select p.id, coalesce(nullif(p.full_name, ''), p.email) as name, r.name as region_name
      from public.technicians tc
      join public.profiles p on p.id = tc.id
      left join public.regions r on r.id = tc.region_id
     where p.is_active and (p_region is null or tc.region_id = p_region)
  ),
  v as (
    select v.technician_id,
           count(*)::int as submitted,
           count(*) filter (where v.status = 'APPROVED')::int as approved,
           count(*) filter (where v.status = 'REJECTED')::int as returned,
           count(*) filter (where v.status = 'SUBMITTED')::int as awaiting,
           round(avg(extract(epoch from (v.ended_at - v.started_at)) / 60)
                   filter (where v.ended_at is not null and v.started_at is not null)::numeric, 0) as avg_minutes
      from public.pm_visits v
     where v.submitted_at >= p_from and v.submitted_at < p_to + 1
     group by v.technician_id
  ),
  f as (
    select f.technician_id, count(*)::int as n
      from public.failures f
     where f.detected_at >= p_from and f.detected_at < p_to + 1
     group by f.technician_id
  ),
  ca as (
    select ca.assigned_to,
           count(*) filter (where ca.assigned_at >= p_from and ca.assigned_at < p_to + 1)::int as assigned,
           count(*) filter (where ca.completed_at >= p_from and ca.completed_at < p_to + 1)::int as completed,
           count(*) filter (where ca.status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS') and ca.due_date < current_date)::int as overdue
      from public.corrective_actions ca
     where ca.assigned_to is not null
     group by ca.assigned_to
  )
  select t.id, t.name, t.region_name,
         coalesce(v.submitted, 0), coalesce(v.approved, 0), coalesce(v.returned, 0), coalesce(v.awaiting, 0),
         v.avg_minutes, coalesce(f.n, 0),
         coalesce(ca.assigned, 0), coalesce(ca.completed, 0), coalesce(ca.overdue, 0)
    from t
    left join v on v.technician_id = t.id
    left join f on f.technician_id = t.id
    left join ca on ca.assigned_to = t.id
   order by t.name, t.id
$$;

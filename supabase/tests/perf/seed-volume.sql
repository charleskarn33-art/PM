-- =============================================================================
-- Performance data set (NOT demo data, never loaded outside the perf database).
--
-- Two years of monthly PM for a network of 1,200 sites, generated through the
-- real triggers as a trusted server connection, so failures, analytics
-- projections, notifications and audit entries are produced exactly as in
-- production:
--   6 regions · 12 clusters · 36 counties · 1,200 sites
--   6 managers · 12 supervisors · 100 technicians · 10 maintenance users
--   ~28,800 schedules, ~26,000 PM visits, ~1.6M checklist answers,
--   ~400,000 readings, ~52,000 photos, failures and corrective actions.
-- Values are synthetic; nothing here is an engineering threshold.
-- =============================================================================
set client_min_messages = warning;
select setseed(0.42);

-- Workflow tests submit without filling every item; so does this data set.
update public.pm_checklist_items set is_required = false, requires_photo_on_failure = false,
  requires_comment_on_failure = false, requires_photo_on_answer = '{}', requires_comment_on_answer = '{}';
update public.pm_reading_fields set is_required = false;

-- ---------------------------------------------------------------------------
-- Organisation and people
-- ---------------------------------------------------------------------------
insert into public.regions (code, name)
select 'PR' || r, 'Perf Region ' || r from generate_series(1, 6) r;
insert into public.clusters (region_id, code, name)
select g.id, g.code || '-C' || c, g.name || ' Cluster ' || c from public.regions g, generate_series(1, 2) c where g.code like 'PR%';
insert into public.counties (cluster_id, code, name)
select c.id, c.code || '-K' || k, c.name || ' County ' || k from public.clusters c, generate_series(1, 3) k where c.code like 'PR%';

create temporary table perf_people as
select gen_random_uuid() as id, kind, n, format('%s.%s@perf.local', kind, n) as email
  from (values ('supervisor', 12), ('manager', 6), ('technician', 100), ('maintenance', 10)) v(kind, cnt),
       generate_series(1, v.cnt) n;
insert into auth.users (id, email, raw_user_meta_data)
select id, email, jsonb_build_object('full_name', initcap(kind) || ' ' || n) from perf_people;

-- Region of each person: supervisors 2 per region, managers 1, technicians round-robin.
create temporary table perf_regions as
select id, row_number() over (order by code) as rn from public.regions where code like 'PR%';
update public.profiles p
   set role = case pp.kind when 'supervisor' then 'regional_supervisor' when 'manager' then 'regional_manager'
                           when 'technician' then 'technician' else 'maintenance' end::public.app_role,
       is_active = true,
       region_id = case when pp.kind = 'maintenance' then null
                        else (select r.id from perf_regions r where r.rn = case pp.kind when 'supervisor' then (pp.n - 1) / 2 + 1
                                                                                     else (pp.n - 1) % 6 + 1 end) end
  from perf_people pp where pp.id = p.id;

insert into public.supervisors (id) select id from perf_people where kind = 'supervisor';
insert into public.user_region_scopes (profile_id, region_id)
select p.id, p.region_id from public.profiles p join perf_people pp on pp.id = p.id where pp.kind in ('supervisor', 'manager');
insert into public.technicians (id, region_id, supervisor_id)
select p.id, p.region_id,
       (select s.id from public.profiles s join perf_people sp on sp.id = s.id
         where sp.kind = 'supervisor' and s.region_id = p.region_id order by sp.n limit 1)
  from public.profiles p join perf_people pp on pp.id = p.id where pp.kind = 'technician';

-- 1,200 sites: 200 per region spread over its counties, each with one of the
-- region's supervisors and one of its technicians.
create temporary table perf_sites as
select gen_random_uuid() as id, s as n, r.id as region_id, r.rn from perf_regions r, generate_series(1, 200) s;
insert into public.sites (id, site_code, site_name, region_id, county_id, latitude, longitude,
                          generator_available, battery_available, solar_available, supervisor_id)
select ps.id, format('P%s-%s', ps.rn, lpad(ps.n::text, 4, '0')), format('Perf Site %s-%s', ps.rn, ps.n), ps.region_id,
       (select k.id from public.counties k join public.clusters c on c.id = k.cluster_id where c.region_id = ps.region_id
         order by k.code offset (ps.n % 6) limit 1),
       4.5 + random() * 3.5, -11.5 + random() * 4.0,
       true, true, ps.n % 3 = 0,
       (select s.id from public.profiles s join perf_people sp on sp.id = s.id
         where sp.kind = 'supervisor' and s.region_id = ps.region_id order by sp.n offset (ps.n % 2) limit 1)
  from perf_sites ps;

create temporary table perf_site_tech as
select ps.id as site_id,
       (select t.id from public.technicians t join perf_people tp on tp.id = t.id
         where t.region_id = ps.region_id order by tp.n offset (ps.n % (select count(*) from public.technicians t2 where t2.region_id = ps.region_id)) limit 1) as technician_id
  from perf_sites ps;
insert into public.site_assignments (site_id, technician_id, starts_on)
select site_id, technician_id, current_date - 800 from perf_site_tech;

-- ---------------------------------------------------------------------------
-- Two years of monthly schedules and the PMs done against them
-- ---------------------------------------------------------------------------
insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date, frequency)
select st.site_id, t.id, st.technician_id, d - 7, d, 'MONTHLY'
  from perf_site_tech st
 cross join (select id from public.pm_templates where status = 'ACTIVE') t
 cross join lateral (select (date_trunc('month', current_date) - make_interval(months => m) + interval '14 days')::date as d
                       from generate_series(0, 23) m) due;

-- 95% of past schedules were done, two days before the due date.
insert into public.pm_visits (site_id, template_id, technician_id, schedule_id, status, started_at, ended_at,
                              gps_latitude, gps_longitude, gps_accuracy_m)
select ps.site_id, ps.template_id, ps.technician_id, ps.id, 'IN_PROGRESS',
       ps.due_date - 2 + interval '9 hours', ps.due_date - 2 + interval '10 hours 15 minutes',
       s.latitude, s.longitude, 6
  from public.pm_schedules ps join public.sites s on s.id = ps.site_id
 where s.site_code like 'P%-%' and ps.due_date < date_trunc('month', current_date) and random() < 0.95;

-- Answers: all-clear except ~2% of items that raise a failure.
insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, answer, numeric_value)
select v.id, i.id, '',
       case when i.response_type <> 'YES_NO_NA' then null
            when random() < 0.02 then (case when i.creates_failure_on_yes then 'YES' else 'NO' end)::public.yes_no_na
            else (case when i.creates_failure_on_yes then 'NO' else 'YES' end)::public.yes_no_na end,
       case when i.response_type <> 'NUMBER' then null
            when coalesce((i.metadata ->> 'integer')::boolean, false) then 0
            else round((8 + random() * 10)::numeric, 1) end
  from public.pm_visits v
  join public.pm_sections s on s.template_id = v.template_id
  join public.pm_checklist_items i on i.section_id = s.id and i.is_active
 where v.status = 'IN_PROGRESS' and not (s.code = any (v.not_applicable_sections))
   and i.response_type in ('YES_NO_NA', 'NUMBER');

insert into public.pm_readings (visit_id, reading_field_id, label_snapshot, numeric_value, text_value)
select v.id, f.id, '',
       case f.code
         when 'running_hours' then 8000 + (random() * 9000)::int
         when 'oil_pressure' then round((3 + random())::numeric, 1)
         when 'fuel_level' then (20 + random() * 80)::int
         when 'generator_kva' then 20
         when 'rectifier_output_voltage' then round((53 + random())::numeric, 1)
         when 'load_current' then round((25 + random() * 40)::numeric, 1)
         when 'rectifier_module_count' then 4
         when 'dc_modules_installed' then 4
         when 'dc_modules_operational' then 4
         when 'battery_voltage' then round((51.5 + random() * 2)::numeric, 1)
         when 'battery_capacity' then 200
         when 'battery_strings' then 2
         when 'panels_installed' then 12
         when 'panels_operational' then 12
         when 'charge_controller_output' then round((40 + random() * 10)::numeric, 1)
       end,
       case when f.value_type = 'TEXT' then 'NCU' end
  from public.pm_visits v
  join public.pm_sections s on s.template_id = v.template_id
  join public.pm_reading_fields f on f.section_id = s.id and f.is_active
 where v.status = 'IN_PROGRESS' and not (s.code = any (v.not_applicable_sections));

-- Two photos per PM (files first, then the rows, as the app does).
create temporary table perf_photos as
select v.id as visit_id, v.site_id, v.technician_id, s.id as section_id, n,
       format('%s/%s/%s.jpg', v.site_id, v.id, gen_random_uuid()) as path
  from public.pm_visits v
  join lateral (select id from public.pm_sections where template_id = v.template_id order by sort_order limit 2) s on true
  cross join lateral (select 1 as n) x
 where v.status = 'IN_PROGRESS';
insert into storage.objects (bucket_id, name, owner_id) select 'pm-photos', path, technician_id::text from perf_photos;
insert into public.pm_photos (site_id, visit_id, section_id, file_path, taken_at, uploaded_by)
select site_id, visit_id, section_id, path, now(), technician_id from perf_photos;

-- Submit everything, keeping the historical submission time.
update public.pm_visits set status = 'SUBMITTED' where status = 'IN_PROGRESS' and technician_id in (select id from perf_people);
select set_config('ipt.system_update', 'on', false);
update public.pm_visits set submitted_at = ended_at where technician_id in (select id from perf_people);
update public.failures f set detected_at = v.submitted_at from public.pm_visits v
 where v.id = f.visit_id and v.technician_id in (select id from perf_people);
select set_config('ipt.system_update', 'off', false);

-- Supervisors approved all but the last month's PMs.
update public.pm_visits v
   set status = 'APPROVED', reviewed_by = v.supervisor_id, reviewed_at = v.submitted_at + interval '2 days'
 where v.technician_id in (select id from perf_people) and v.submitted_at < date_trunc('month', current_date) - interval '1 month';

-- ---------------------------------------------------------------------------
-- Corrective actions for 60% of the failures; older ones worked and verified
-- ---------------------------------------------------------------------------
insert into public.corrective_actions (failure_id, site_id, category, description, assigned_to, due_date)
select f.id, f.site_id, f.category, 'Fix: ' || left(f.description, 80), st.technician_id, (f.detected_at + interval '14 days')::date
  from public.failures f join perf_site_tech st on st.site_id = f.site_id
 where random() < 0.6;
update public.corrective_actions ca set status = 'COMPLETED', resolution = 'Repaired and tested.'
 where ca.site_id in (select id from perf_sites) and ca.due_date < current_date - 30;
update public.corrective_actions ca set status = 'VERIFIED'
 where ca.site_id in (select id from perf_sites) and ca.status = 'COMPLETED' and ca.due_date < current_date - 60;

analyze;

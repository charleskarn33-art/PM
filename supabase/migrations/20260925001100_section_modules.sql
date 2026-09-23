-- =============================================================================
-- Phase 4: section modules
--   * projection of answers/readings into the per-section analytics tables
--     (generator, DC incl. phase currents and calculated kW, battery, solar,
--     earthing), driven by analytics_key on reading fields / checklist items
--   * data-driven consistency rules between values (e.g. operational <= installed)
--   * sections default to N/A when the site lacks the equipment
-- Measured values are copied, never modified; calculated values live in their
-- own columns (dc_readings.dc_power_kw).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- All keyed values of a visit, excluding sections marked N/A.
-- One row per reading / response that has an analytics_key.
-- -----------------------------------------------------------------------------
create or replace function private.visit_key_values(p_visit_id uuid)
returns table (
  key text,
  section_code text,
  num numeric,
  txt text,
  answer public.yes_no_na,
  comment text,
  metadata jsonb
)
language sql stable security definer
set search_path = ''
as $$
  with v as (select * from public.pm_visits where id = p_visit_id),
  sections as (
    select s.id, s.code from public.pm_sections s, v
     where s.template_id = v.template_id and s.is_active
       and not (s.code = any (v.not_applicable_sections))
  )
  select f.analytics_key, s.code, r.numeric_value, r.text_value, null::public.yes_no_na, null::text, '{}'::jsonb
    from public.pm_readings r
    join public.pm_reading_fields f on f.id = r.reading_field_id
    join sections s on s.id = f.section_id
   where r.visit_id = p_visit_id and f.analytics_key is not null and f.is_active
  union all
  select i.analytics_key, s.code, r.numeric_value, r.text_value, r.answer, r.comment, i.metadata
    from public.pm_responses r
    join public.pm_checklist_items i on i.id = r.checklist_item_id
    join sections s on s.id = i.section_id
   where r.visit_id = p_visit_id and i.analytics_key is not null and i.is_active
$$;

-- YES -> true, NO -> false, N/A or unanswered -> null.
create or replace function private.yes_no(p_answer public.yes_no_na)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_answer when 'YES' then true when 'NO' then false end
$$;

-- -----------------------------------------------------------------------------
-- Projection
-- -----------------------------------------------------------------------------
create or replace function private.refresh_visit_analytics(p_visit_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.pm_visits;
  v_at timestamptz;
  v_sections text[];
  v_kv jsonb;
begin
  select * into v from public.pm_visits where id = p_visit_id;
  if not found then
    return;
  end if;
  v_at := coalesce(v.started_at, v.created_at);

  -- Keyed values, computed once and read by each section below.
  select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb) into v_kv from private.visit_key_values(p_visit_id) k;

  select coalesce(array_agg(distinct s.code), '{}') into v_sections
    from public.pm_sections s
   where s.template_id = v.template_id and s.is_active and not (s.code = any (v.not_applicable_sections));

  -- Generator ----------------------------------------------------------------
  if 'GENERATOR' = any (v_sections) then
    insert into public.generator_readings as g (visit_id, site_id, recorded_at, running_hours, oil_pressure_bar,
      fuel_level_pct, generator_kva, engine_oil_changed, fuel_filter_changed, oil_filter_changed, requires_service)
    select p_visit_id, v.site_id, v_at,
      max(num) filter (where key = 'generator.running_hours'),
      max(num) filter (where key = 'generator.oil_pressure_bar'),
      max(num) filter (where key = 'generator.fuel_level_pct'),
      max(num) filter (where key = 'generator.generator_kva'),
      bool_or(private.yes_no(answer)) filter (where key = 'generator.engine_oil_changed'),
      bool_or(private.yes_no(answer)) filter (where key = 'generator.fuel_filter_changed'),
      bool_or(private.yes_no(answer)) filter (where key = 'generator.oil_filter_changed'),
      bool_or(private.yes_no(answer)) filter (where key = 'generator.requires_service')
      from jsonb_to_recordset(v_kv) as k(key text, section_code text, num numeric, txt text, answer public.yes_no_na, comment text, metadata jsonb)
    on conflict (visit_id) do update set
      site_id = excluded.site_id, recorded_at = excluded.recorded_at,
      running_hours = excluded.running_hours, oil_pressure_bar = excluded.oil_pressure_bar,
      fuel_level_pct = excluded.fuel_level_pct, generator_kva = excluded.generator_kva,
      engine_oil_changed = excluded.engine_oil_changed, fuel_filter_changed = excluded.fuel_filter_changed,
      oil_filter_changed = excluded.oil_filter_changed, requires_service = excluded.requires_service;
  else
    delete from public.generator_readings where visit_id = p_visit_id;
  end if;

  -- DC system ----------------------------------------------------------------
  if 'DC_SYSTEM' = any (v_sections) then
    insert into public.dc_readings (visit_id, site_id, recorded_at, rectifier_voltage_v, load_current_a,
      rectifier_module_count, dc_modules_installed, dc_modules_operational, controller_model)
    select p_visit_id, v.site_id, v_at,
      max(num) filter (where key = 'dc.rectifier_voltage_v'),
      max(num) filter (where key = 'dc.load_current_a'),
      max(num) filter (where key = 'dc.rectifier_module_count')::int,
      max(num) filter (where key = 'dc.dc_modules_installed')::int,
      max(num) filter (where key = 'dc.dc_modules_operational')::int,
      max(txt) filter (where key = 'dc.controller_model')
      from jsonb_to_recordset(v_kv) as k(key text, section_code text, num numeric, txt text, answer public.yes_no_na, comment text, metadata jsonb)
    on conflict (visit_id) do update set
      site_id = excluded.site_id, recorded_at = excluded.recorded_at,
      rectifier_voltage_v = excluded.rectifier_voltage_v, load_current_a = excluded.load_current_a,
      rectifier_module_count = excluded.rectifier_module_count, dc_modules_installed = excluded.dc_modules_installed,
      dc_modules_operational = excluded.dc_modules_operational, controller_model = excluded.controller_model;

    delete from public.dc_phase_currents d
     where d.visit_id = p_visit_id
       and not exists (
         select 1 from jsonb_to_recordset(v_kv) as k(key text, section_code text, num numeric, txt text, answer public.yes_no_na, comment text, metadata jsonb)
          where k.key = 'dc.phase_current' and k.num is not null
            and (k.metadata ->> 'phase_number')::smallint = d.phase_number);
    insert into public.dc_phase_currents (visit_id, site_id, phase_number, amp_value, unit, comment, recorded_at)
    select p_visit_id, v.site_id, (metadata ->> 'phase_number')::smallint, num, 'A', comment, v_at
      from jsonb_to_recordset(v_kv) as k(key text, section_code text, num numeric, txt text, answer public.yes_no_na, comment text, metadata jsonb)
     where key = 'dc.phase_current' and num is not null and metadata ? 'phase_number'
    on conflict (visit_id, phase_number) do update set
      amp_value = excluded.amp_value, comment = excluded.comment, site_id = excluded.site_id,
      recorded_at = excluded.recorded_at;
  else
    delete from public.dc_readings where visit_id = p_visit_id;
    delete from public.dc_phase_currents where visit_id = p_visit_id;
  end if;

  -- Battery ------------------------------------------------------------------
  if 'BATTERY' = any (v_sections) then
    insert into public.battery_readings (visit_id, site_id, recorded_at, battery_voltage_v, capacity_ah,
      string_count, physical_damage_found, water_top_up_required)
    select p_visit_id, v.site_id, v_at,
      max(num) filter (where key = 'battery.battery_voltage_v'),
      max(num) filter (where key = 'battery.capacity_ah'),
      max(num) filter (where key = 'battery.string_count')::int,
      bool_or(private.yes_no(answer)) filter (where key = 'battery.physical_damage_found'),
      bool_or(private.yes_no(answer)) filter (where key = 'battery.water_top_up_required')
      from jsonb_to_recordset(v_kv) as k(key text, section_code text, num numeric, txt text, answer public.yes_no_na, comment text, metadata jsonb)
    on conflict (visit_id) do update set
      site_id = excluded.site_id, recorded_at = excluded.recorded_at,
      battery_voltage_v = excluded.battery_voltage_v, capacity_ah = excluded.capacity_ah,
      string_count = excluded.string_count, physical_damage_found = excluded.physical_damage_found,
      water_top_up_required = excluded.water_top_up_required;
  else
    delete from public.battery_readings where visit_id = p_visit_id;
  end if;

  -- Solar --------------------------------------------------------------------
  if 'SOLAR' = any (v_sections) then
    insert into public.solar_readings (visit_id, site_id, recorded_at, panels_installed, panels_operational,
      damaged_panel_count, charge_controller_output_v, panels_cleaned, system_operating_normally)
    select p_visit_id, v.site_id, v_at,
      max(num) filter (where key = 'solar.panels_installed')::int,
      max(num) filter (where key = 'solar.panels_operational')::int,
      max(num) filter (where key = 'solar.damaged_panel_count')::int,
      max(num) filter (where key = 'solar.charge_controller_output_v'),
      bool_or(private.yes_no(answer)) filter (where key = 'solar.panels_cleaned'),
      bool_or(private.yes_no(answer)) filter (where key = 'solar.system_operating_normally')
      from jsonb_to_recordset(v_kv) as k(key text, section_code text, num numeric, txt text, answer public.yes_no_na, comment text, metadata jsonb)
    on conflict (visit_id) do update set
      site_id = excluded.site_id, recorded_at = excluded.recorded_at,
      panels_installed = excluded.panels_installed, panels_operational = excluded.panels_operational,
      damaged_panel_count = excluded.damaged_panel_count, charge_controller_output_v = excluded.charge_controller_output_v,
      panels_cleaned = excluded.panels_cleaned, system_operating_normally = excluded.system_operating_normally;
  else
    delete from public.solar_readings where visit_id = p_visit_id;
  end if;

  -- Earthing -----------------------------------------------------------------
  if 'EARTHING' = any (v_sections) then
    insert into public.earthing_readings (visit_id, site_id, recorded_at, inspected, earth_cable_connected,
      free_from_corrosion, pit_condition_acceptable, abnormalities_found)
    select p_visit_id, v.site_id, v_at,
      bool_or(private.yes_no(answer)) filter (where key = 'earthing.inspected'),
      bool_or(private.yes_no(answer)) filter (where key = 'earthing.earth_cable_connected'),
      bool_or(private.yes_no(answer)) filter (where key = 'earthing.free_from_corrosion'),
      bool_or(private.yes_no(answer)) filter (where key = 'earthing.pit_condition_acceptable'),
      bool_or(private.yes_no(answer)) filter (where key = 'earthing.abnormalities_found')
      from jsonb_to_recordset(v_kv) as k(key text, section_code text, num numeric, txt text, answer public.yes_no_na, comment text, metadata jsonb)
    on conflict (visit_id) do update set
      site_id = excluded.site_id, recorded_at = excluded.recorded_at,
      inspected = excluded.inspected, earth_cable_connected = excluded.earth_cable_connected,
      free_from_corrosion = excluded.free_from_corrosion, pit_condition_acceptable = excluded.pit_condition_acceptable,
      abnormalities_found = excluded.abnormalities_found;
  else
    delete from public.earthing_readings where visit_id = p_visit_id;
  end if;
end;
$$;

-- Statement-level refresh: a bulk write (e.g. an offline sync pushing a whole
-- checklist) refreshes each affected visit once instead of once per row.
-- Replaces the Phase 3 row-level progress triggers.
create or replace function private.refresh_visits_after_statement()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select distinct visit_id from changed_rows
  loop
    perform private.refresh_visit_progress(v_id);
    perform private.refresh_visit_analytics(v_id);
  end loop;
  return null;
end;
$$;

drop trigger refresh_progress_responses on public.pm_responses;
drop trigger refresh_progress_readings on public.pm_readings;

create trigger refresh_visits_responses_ins after insert on public.pm_responses
  referencing new table as changed_rows for each statement execute function private.refresh_visits_after_statement();
create trigger refresh_visits_responses_upd after update on public.pm_responses
  referencing new table as changed_rows for each statement execute function private.refresh_visits_after_statement();
create trigger refresh_visits_responses_del after delete on public.pm_responses
  referencing old table as changed_rows for each statement execute function private.refresh_visits_after_statement();
create trigger refresh_visits_readings_ins after insert on public.pm_readings
  referencing new table as changed_rows for each statement execute function private.refresh_visits_after_statement();
create trigger refresh_visits_readings_upd after update on public.pm_readings
  referencing new table as changed_rows for each statement execute function private.refresh_visits_after_statement();
create trigger refresh_visits_readings_del after delete on public.pm_readings
  referencing old table as changed_rows for each statement execute function private.refresh_visits_after_statement();

-- N/A changes: progress is recomputed by the visit guard; analytics here.
create or replace function private.on_visit_sections_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.refresh_visit_analytics(new.id);
  return null;
end;
$$;

create trigger refresh_analytics_visit
  after update of not_applicable_sections, started_at on public.pm_visits
  for each row execute function private.on_visit_sections_change();

-- -----------------------------------------------------------------------------
-- Sections default to N/A when the site does not have the equipment.
-- Runs before guard_pm_visit (triggers fire in name order), which validates it.
-- The technician can switch a section back on (e.g. site data is out of date).
-- -----------------------------------------------------------------------------
create or replace function private.default_not_applicable_sections()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_site jsonb;
begin
  if coalesce(cardinality(new.not_applicable_sections), 0) > 0 then
    return new;
  end if;
  select to_jsonb(s) into v_site from public.sites s where s.id = new.site_id;
  new.not_applicable_sections := coalesce((
    select array_agg(sec.code order by sec.sort_order)
      from public.pm_sections sec
     where sec.template_id = new.template_id and sec.is_active and sec.allow_not_applicable
       and sec.applicable_site_flag is not null
       and coalesce((v_site ->> sec.applicable_site_flag)::boolean, false) = false
  ), '{}');
  return new;
end;
$$;

create trigger default_not_applicable_sections
  before insert on public.pm_visits
  for each row execute function private.default_not_applicable_sections();

-- -----------------------------------------------------------------------------
-- Consistency rules between keyed values (data, editable by admins).
-- Only definitional relationships are seeded; no engineering thresholds.
-- -----------------------------------------------------------------------------
create table public.pm_consistency_rules (
  id          uuid primary key default gen_random_uuid(),
  lhs_key     text not null,
  operator    text not null check (operator in ('<=', '<', '>=', '>', '=')),
  rhs_key     text not null,
  message     text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  unique (lhs_key, operator, rhs_key)
);
select private.attach_audit_trigger('public.pm_consistency_rules');
create trigger audit_consistency_rules after insert or update or delete on public.pm_consistency_rules
  for each row execute function private.audit_row_change('CONSISTENCY_RULE');

insert into public.pm_consistency_rules (lhs_key, operator, rhs_key, message) values
  ('dc.dc_modules_operational', '<=', 'dc.dc_modules_installed', 'DC Modules Operational cannot exceed DC Modules Installed.'),
  ('solar.panels_operational', '<=', 'solar.panels_installed', 'Panels Operational cannot exceed Panels Installed.'),
  ('solar.damaged_panel_count', '<=', 'solar.panels_installed', 'Damaged solar panels cannot exceed Panels Installed.');

alter table public.pm_consistency_rules enable row level security;
revoke all on public.pm_consistency_rules from anon;
grant select, insert, update, delete on public.pm_consistency_rules to authenticated;
create policy pm_consistency_rules_select on public.pm_consistency_rules
  for select to authenticated using ((select private.is_active_user()));
create policy pm_consistency_rules_admin_insert on public.pm_consistency_rules
  for insert to authenticated with check ((select private.is_admin()));
create policy pm_consistency_rules_admin_update on public.pm_consistency_rules
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy pm_consistency_rules_admin_delete on public.pm_consistency_rules
  for delete to authenticated using ((select private.is_admin()));

create or replace function private.compare(p_lhs numeric, p_op text, p_rhs numeric)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_op
    when '<=' then p_lhs <= p_rhs when '<' then p_lhs < p_rhs
    when '>=' then p_lhs >= p_rhs when '>' then p_lhs > p_rhs
    when '=' then p_lhs = p_rhs end
$$;

-- Submission issues, now including INCONSISTENT values (replaces Phase 3).
create or replace function private.visit_issues_for(p_visit_id uuid, p_template_id uuid, p_na_sections text[])
returns table (section_code text, ref_type text, ref_id uuid, label text, issue text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_enforce_photos boolean;
begin
  select coalesce((value ->> 'enforce_photo_requirements')::boolean, true)
    into v_enforce_photos from public.system_settings where key = 'pm_submission';
  v_enforce_photos := coalesce(v_enforce_photos, true);

  return query
  with sections as (
    select s.* from public.pm_sections s
     where s.template_id = p_template_id and s.is_active
       and not (s.code = any (coalesce(p_na_sections, '{}')))
  ),
  items as (
    select i, s.code as section_code, r as resp,
           (r.id is not null and r.is_failure) as failed
      from public.pm_checklist_items i
      join sections s on s.id = i.section_id
      left join public.pm_responses r on r.visit_id = p_visit_id and r.checklist_item_id = i.id
     where i.is_active
  ),
  item_photos as (
    select p.checklist_item_id, count(*) as n
      from public.pm_photos p
     where p.visit_id = p_visit_id and p.checklist_item_id is not null
     group by p.checklist_item_id
  ),
  kv as (
    -- Keyed numeric values in applicable sections (single-valued keys only).
    select f.analytics_key as key, s.code as section_code, r.numeric_value as num
      from public.pm_readings r
      join public.pm_reading_fields f on f.id = r.reading_field_id and f.is_active
      join sections s on s.id = f.section_id
     where r.visit_id = p_visit_id and f.analytics_key is not null and r.numeric_value is not null
    union all
    select i.analytics_key, s.code, r.numeric_value
      from public.pm_responses r
      join public.pm_checklist_items i on i.id = r.checklist_item_id and i.is_active
      join sections s on s.id = i.section_id
     where r.visit_id = p_visit_id and i.analytics_key is not null and i.analytics_key <> 'dc.phase_current'
       and r.numeric_value is not null
  )
  select it.section_code, 'item', (it.i).id, (it.i).prompt, 'REQUIRED'
    from items it
   where (it.i).is_required and not private.response_has_value(it.i, it.resp)
     and (it.i).response_type <> 'PHOTO'
  union all
  select it.section_code, 'item', (it.i).id, (it.i).prompt, 'COMMENT_REQUIRED'
    from items it
   where nullif(btrim((it.resp).comment), '') is null
     and ( (it.failed and (it.i).requires_comment_on_failure)
        or ((it.resp).answer is not null and (it.resp).answer = any ((it.i).requires_comment_on_answer)) )
  union all
  select it.section_code, 'item', (it.i).id, (it.i).prompt, 'PHOTO_REQUIRED'
    from items it
    left join item_photos ph on ph.checklist_item_id = (it.i).id
   where v_enforce_photos
     and coalesce(ph.n, 0) = 0
     and ( ((it.i).response_type = 'PHOTO' and (it.i).is_required)
        or (it.failed and (it.i).requires_photo_on_failure)
        or ((it.resp).answer is not null and (it.resp).answer = any ((it.i).requires_photo_on_answer)) )
  union all
  select s.code, 'reading', f.id, f.label, 'REQUIRED'
    from public.pm_reading_fields f
    join sections s on s.id = f.section_id
    left join public.pm_readings r on r.visit_id = p_visit_id and r.reading_field_id = f.id
   where f.is_active and f.is_required and not private.reading_has_value(f, r)
  union all
  select l.section_code, 'rule', cr.id, cr.message, 'INCONSISTENT'
    from public.pm_consistency_rules cr
    join kv l on l.key = cr.lhs_key
    join kv r on r.key = cr.rhs_key
   where cr.is_active and not private.compare(l.num, cr.operator, r.num);
end;
$$;

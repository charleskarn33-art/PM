-- =============================================================================
-- PM templates (data-driven checklist engine), schedules, visits, responses,
-- readings, photos and per-section analytics tables.
--
-- Checklist items and reading fields are NEVER hard-deleted once referenced:
-- deactivate them (is_active = false). Historical responses keep a snapshot of
-- the prompt text they answered.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- pm_templates (versioned)
-- -----------------------------------------------------------------------------
create table public.pm_templates (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  name         text not null,
  version      integer not null default 1 check (version > 0),
  status       public.template_status not null default 'DRAFT',
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  unique (code, version)
);
-- At most one ACTIVE version per template code.
create unique index pm_templates_one_active_idx on public.pm_templates (code) where status = 'ACTIVE';

-- -----------------------------------------------------------------------------
-- pm_sections
-- -----------------------------------------------------------------------------
create table public.pm_sections (
  id                       uuid primary key default gen_random_uuid(),
  template_id              uuid not null references public.pm_templates (id) on delete restrict,
  code                     text not null,
  name                     text not null,
  category                 public.pm_category not null,
  sort_order               integer not null default 0,
  description              text,
  -- Whole section may be marked N/A (e.g. Solar on a site without solar).
  allow_not_applicable     boolean not null default false,
  -- If set, section defaults to N/A when the site lacks this equipment.
  applicable_site_flag     text check (applicable_site_flag in
                             ('generator_available', 'solar_available', 'battery_available', 'grid_available')),
  is_active                boolean not null default true,
  deactivated_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references public.profiles (id) on delete set null,
  updated_by               uuid references public.profiles (id) on delete set null,
  unique (template_id, code)
);
create index pm_sections_template_idx on public.pm_sections (template_id, sort_order);

-- -----------------------------------------------------------------------------
-- pm_reading_fields: numeric / text readings shown at the top of a section
-- -----------------------------------------------------------------------------
create table public.pm_reading_fields (
  id             uuid primary key default gen_random_uuid(),
  section_id     uuid not null references public.pm_sections (id) on delete restrict,
  code           text not null,
  label          text not null,
  value_type     public.response_type not null default 'NUMBER'
                   check (value_type in ('NUMBER', 'TEXT', 'SELECT')),
  unit           text,
  is_integer     boolean not null default false,
  min_value      numeric,
  max_value      numeric,
  options        jsonb not null default '[]'::jsonb,
  is_required    boolean not null default false,
  help_text      text,
  -- Stable key used to project the value into the section analytics tables.
  analytics_key  text,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  deactivated_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles (id) on delete set null,
  updated_by     uuid references public.profiles (id) on delete set null,
  unique (section_id, code),
  constraint pm_reading_fields_range check (min_value is null or max_value is null or min_value <= max_value),
  constraint pm_reading_fields_options_array check (jsonb_typeof(options) = 'array')
);
create index pm_reading_fields_section_idx on public.pm_reading_fields (section_id, sort_order);

-- -----------------------------------------------------------------------------
-- pm_checklist_items: configurable questions and their failure rules
-- -----------------------------------------------------------------------------
create table public.pm_checklist_items (
  id                          uuid primary key default gen_random_uuid(),
  section_id                  uuid not null references public.pm_sections (id) on delete restrict,
  code                        text not null,
  prompt                      text not null,
  help_text                   text,
  response_type               public.response_type not null default 'YES_NO_NA',
  options                     jsonb not null default '[]'::jsonb,
  allow_not_applicable        boolean not null default true,
  is_required                 boolean not null default true,
  unit                        text,
  min_value                   numeric,
  max_value                   numeric,
  -- Failure rules (YES_NO_NA items)
  creates_failure_on_no       boolean not null default false,
  creates_failure_on_yes      boolean not null default false,
  failure_severity            public.severity_level not null default 'MEDIUM',
  requires_photo_on_failure   boolean not null default false,
  requires_comment_on_failure boolean not null default false,
  -- Conditional evidence independent of failure (e.g. fire extinguisher = YES
  -- requires a photo of the expiry date; water top-up = YES requires a comment).
  requires_photo_on_answer    public.yes_no_na[] not null default '{}',
  requires_comment_on_answer  public.yes_no_na[] not null default '{}',
  photo_instructions          text,
  -- Free-form structured metadata, e.g. {"phase_number": 3} for clamp-meter items.
  metadata                    jsonb not null default '{}'::jsonb,
  analytics_key               text,
  sort_order                  integer not null default 0,
  is_active                   boolean not null default true,
  deactivated_at              timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid references public.profiles (id) on delete set null,
  updated_by                  uuid references public.profiles (id) on delete set null,
  unique (section_id, code),
  constraint pm_checklist_items_range check (min_value is null or max_value is null or min_value <= max_value),
  constraint pm_checklist_items_failure_rules check (
    (not creates_failure_on_no and not creates_failure_on_yes) or response_type = 'YES_NO_NA'
  ),
  constraint pm_checklist_items_single_failure_polarity check (not (creates_failure_on_no and creates_failure_on_yes)),
  constraint pm_checklist_items_options_array check (jsonb_typeof(options) = 'array'),
  constraint pm_checklist_items_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index pm_checklist_items_section_idx on public.pm_checklist_items (section_id, sort_order);

-- -----------------------------------------------------------------------------
-- pm_schedules
-- -----------------------------------------------------------------------------
create table public.pm_schedules (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites (id) on delete restrict,
  template_id     uuid not null references public.pm_templates (id) on delete restrict,
  technician_id   uuid references public.technicians (id) on delete set null,
  supervisor_id   uuid references public.supervisors (id) on delete set null,
  frequency       public.pm_frequency not null default 'MONTHLY',
  scheduled_date  date not null,
  due_date        date not null,
  status          public.pm_status not null default 'SCHEDULED',
  priority        public.priority_level not null default 'MEDIUM',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null,
  updated_by      uuid references public.profiles (id) on delete set null,
  constraint pm_schedules_dates check (due_date >= scheduled_date)
);
create index pm_schedules_site_idx on public.pm_schedules (site_id, scheduled_date desc);
create index pm_schedules_technician_idx on public.pm_schedules (technician_id, due_date);
create index pm_schedules_status_due_idx on public.pm_schedules (status, due_date);

-- -----------------------------------------------------------------------------
-- pm_visits
-- id is generated on the device (offline-first) so repeated sync attempts
-- upsert the same row instead of creating duplicates.
-- -----------------------------------------------------------------------------
create table public.pm_visits (
  id                        uuid primary key default gen_random_uuid(),
  schedule_id               uuid references public.pm_schedules (id) on delete set null,
  site_id                   uuid not null references public.sites (id) on delete restrict,
  template_id               uuid not null references public.pm_templates (id) on delete restrict,
  technician_id             uuid not null references public.technicians (id) on delete restrict,
  supervisor_id             uuid references public.supervisors (id) on delete set null,
  status                    public.pm_status not null default 'IN_PROGRESS',
  started_at                timestamptz,
  ended_at                  timestamptz,
  submitted_at              timestamptz,
  -- GPS at PM start
  gps_latitude              double precision check (gps_latitude between -90 and 90),
  gps_longitude             double precision check (gps_longitude between -180 and 180),
  gps_accuracy_m            double precision check (gps_accuracy_m >= 0),
  gps_captured_at           timestamptz,
  gps_distance_m            double precision check (gps_distance_m >= 0),
  gps_radius_m              integer,
  gps_status                public.gps_status,
  geofence_mode             public.geofence_mode,
  outside_radius_reason     text,
  -- Derived (maintained server-side from responses; see Phase 3)
  completion_pct            numeric(5, 2) not null default 0 check (completion_pct between 0 and 100),
  failure_count             integer not null default 0 check (failure_count >= 0),
  not_applicable_sections   text[] not null default '{}',
  overall_comments          text,
  is_demo                   boolean not null default false,
  technician_signature_path text,
  technician_signed_at      timestamptz,
  reviewed_by               uuid references public.profiles (id) on delete set null,
  reviewed_at               timestamptz,
  review_comments           text,
  -- Offline sync metadata
  device_id                 text,
  client_created_at         timestamptz,
  client_updated_at         timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references public.profiles (id) on delete set null,
  updated_by                uuid references public.profiles (id) on delete set null,
  constraint pm_visits_times check (ended_at is null or started_at is null or ended_at >= started_at),
  constraint pm_visits_gps_pair check ((gps_latitude is null) = (gps_longitude is null))
);
create index pm_visits_site_idx on public.pm_visits (site_id, started_at desc);
create index pm_visits_technician_idx on public.pm_visits (technician_id, started_at desc);
create index pm_visits_status_idx on public.pm_visits (status);
create index pm_visits_schedule_idx on public.pm_visits (schedule_id);

-- -----------------------------------------------------------------------------
-- pm_responses: one answer per checklist item per visit (idempotent upsert)
-- -----------------------------------------------------------------------------
create table public.pm_responses (
  id                 uuid primary key default gen_random_uuid(),
  visit_id           uuid not null references public.pm_visits (id) on delete cascade,
  checklist_item_id  uuid not null references public.pm_checklist_items (id) on delete restrict,
  answer             public.yes_no_na,
  numeric_value      numeric,
  text_value         text,
  selected_options   text[],
  date_value         date,
  datetime_value     timestamptz,
  comment            text,
  is_failure         boolean not null default false,
  prompt_snapshot    text not null,
  unit_snapshot      text,
  answered_at        timestamptz,
  answered_by        uuid references public.profiles (id) on delete set null,
  client_updated_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  updated_by         uuid references public.profiles (id) on delete set null,
  unique (visit_id, checklist_item_id)
);
create index pm_responses_item_idx on public.pm_responses (checklist_item_id);
create index pm_responses_failure_idx on public.pm_responses (visit_id) where is_failure;

-- -----------------------------------------------------------------------------
-- pm_readings: raw technician measurements (never overwritten by calculations)
-- -----------------------------------------------------------------------------
create table public.pm_readings (
  id                 uuid primary key default gen_random_uuid(),
  visit_id           uuid not null references public.pm_visits (id) on delete cascade,
  reading_field_id   uuid not null references public.pm_reading_fields (id) on delete restrict,
  numeric_value      numeric,
  text_value         text,
  unit_snapshot      text,
  label_snapshot     text not null,
  captured_at        timestamptz,
  client_updated_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  updated_by         uuid references public.profiles (id) on delete set null,
  unique (visit_id, reading_field_id)
);
create index pm_readings_field_idx on public.pm_readings (reading_field_id);

-- -----------------------------------------------------------------------------
-- Per-section analytics tables: one row per visit, typed columns for
-- dashboards. Populated from pm_readings / pm_responses (Phase 4), never
-- written directly by clients. Calculated values are separate columns.
-- -----------------------------------------------------------------------------
create table public.generator_readings (
  visit_id             uuid primary key references public.pm_visits (id) on delete cascade,
  site_id              uuid not null references public.sites (id) on delete restrict,
  recorded_at          timestamptz not null,
  running_hours        numeric,
  oil_pressure_bar     numeric,
  fuel_level_pct       numeric,
  generator_kva        numeric,
  engine_oil_changed   boolean,
  fuel_filter_changed  boolean,
  oil_filter_changed   boolean,
  requires_service     boolean,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index generator_readings_site_idx on public.generator_readings (site_id, recorded_at desc);

create table public.dc_readings (
  visit_id                 uuid primary key references public.pm_visits (id) on delete cascade,
  site_id                  uuid not null references public.sites (id) on delete restrict,
  recorded_at              timestamptz not null,
  rectifier_voltage_v      numeric,
  load_current_a           numeric,
  rectifier_module_count   integer,
  dc_modules_installed     integer,
  dc_modules_operational   integer,
  controller_model         text,
  -- Calculated, stored separately from the measured values:
  -- DC kW = Voltage x Current / 1000
  dc_power_kw              numeric generated always as (rectifier_voltage_v * load_current_a / 1000) stored,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index dc_readings_site_idx on public.dc_readings (site_id, recorded_at desc);

create table public.dc_phase_currents (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null references public.pm_visits (id) on delete cascade,
  site_id       uuid not null references public.sites (id) on delete restrict,
  phase_number  smallint not null check (phase_number > 0),
  amp_value     numeric,
  unit          text not null default 'A',
  photo_id      uuid,
  comment       text,
  recorded_at   timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (visit_id, phase_number)
);
create index dc_phase_currents_site_idx on public.dc_phase_currents (site_id, recorded_at desc);

create table public.battery_readings (
  visit_id               uuid primary key references public.pm_visits (id) on delete cascade,
  site_id                uuid not null references public.sites (id) on delete restrict,
  recorded_at            timestamptz not null,
  battery_voltage_v      numeric,
  capacity_ah            numeric,
  string_count           integer,
  physical_damage_found  boolean,
  water_top_up_required  boolean,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index battery_readings_site_idx on public.battery_readings (site_id, recorded_at desc);

create table public.solar_readings (
  visit_id                    uuid primary key references public.pm_visits (id) on delete cascade,
  site_id                     uuid not null references public.sites (id) on delete restrict,
  recorded_at                 timestamptz not null,
  panels_installed            integer,
  panels_operational          integer,
  damaged_panel_count         integer,
  charge_controller_output_v  numeric,
  panels_cleaned              boolean,
  system_operating_normally   boolean,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index solar_readings_site_idx on public.solar_readings (site_id, recorded_at desc);

create table public.earthing_readings (
  visit_id                 uuid primary key references public.pm_visits (id) on delete cascade,
  site_id                  uuid not null references public.sites (id) on delete restrict,
  recorded_at              timestamptz not null,
  inspected                boolean,
  earth_cable_connected    boolean,
  free_from_corrosion      boolean,
  pit_condition_acceptable boolean,
  abnormalities_found      boolean,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index earthing_readings_site_idx on public.earthing_readings (site_id, recorded_at desc);

-- Audit-column triggers
select private.attach_audit_trigger('public.pm_templates');
select private.attach_audit_trigger('public.pm_sections');
select private.attach_audit_trigger('public.pm_reading_fields');
select private.attach_audit_trigger('public.pm_checklist_items');
select private.attach_audit_trigger('public.pm_schedules');
select private.attach_audit_trigger('public.pm_visits');
select private.attach_audit_trigger('public.pm_responses');
select private.attach_audit_trigger('public.pm_readings');

-- Analytics tables only carry created_at/updated_at.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_updated_at before update on public.generator_readings for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.dc_readings        for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.dc_phase_currents  for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.battery_readings   for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.solar_readings     for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.earthing_readings  for each row execute function private.touch_updated_at();

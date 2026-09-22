-- =============================================================================
-- Identity, roles and organizational hierarchy
--   REGION -> CLUSTER -> COUNTY -> SITE
-- =============================================================================

-- -----------------------------------------------------------------------------
-- roles: descriptive lookup for the app_role enum (read-only reference data)
-- -----------------------------------------------------------------------------
create table public.roles (
  code        public.app_role primary key,
  name        text not null,
  description text not null,
  sort_order  smallint not null default 0
);

insert into public.roles (code, name, description, sort_order) values
  ('super_admin',         'Super Admin',         'Full access to all data, users and configuration.', 1),
  ('regional_manager',    'Regional Manager',    'Read access to sites, people, PM performance, failures and reports in assigned regions.', 2),
  ('regional_supervisor', 'Regional Supervisor', 'Manages technicians, assignments, PM scheduling and PM review in assigned regions.', 3),
  ('technician',          'Technician',          'Performs preventive maintenance on assigned sites via the mobile app.', 4),
  ('maintenance',         'Maintenance',         'Executes and closes assigned corrective actions.', 5),
  ('viewer',              'Viewer',              'Read-only dashboard and report access.', 6);

-- -----------------------------------------------------------------------------
-- regions
-- -----------------------------------------------------------------------------
create table public.regions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid
);

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user. Created automatically on sign-up and
-- inactive until an administrator activates the account and assigns a role.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  phone       text,
  avatar_url  text,
  role        public.app_role not null default 'viewer' references public.roles (code),
  -- Home region (informational; data scope is defined by user_region_scopes).
  region_id   uuid references public.regions (id) on delete set null,
  is_active   boolean not null default false,
  last_login_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid
);
create index profiles_role_idx on public.profiles (role);
create index profiles_region_idx on public.profiles (region_id);
create unique index profiles_email_lower_idx on public.profiles (lower(email));

-- Audit columns across the schema reference profiles.
alter table public.regions
  add constraint regions_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  add constraint regions_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null;
alter table public.profiles
  add constraint profiles_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  add constraint profiles_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null;

-- -----------------------------------------------------------------------------
-- user_region_scopes: which regions a manager / supervisor may access.
-- -----------------------------------------------------------------------------
create table public.user_region_scopes (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  region_id   uuid not null references public.regions (id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  primary key (profile_id, region_id)
);
create index user_region_scopes_region_idx on public.user_region_scopes (region_id);

-- -----------------------------------------------------------------------------
-- clusters (belong to a region)
-- -----------------------------------------------------------------------------
create table public.clusters (
  id          uuid primary key default gen_random_uuid(),
  region_id   uuid not null references public.regions (id) on delete restrict,
  code        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  unique (region_id, name)
);
create index clusters_region_idx on public.clusters (region_id);

-- -----------------------------------------------------------------------------
-- counties (belong to a cluster)
-- -----------------------------------------------------------------------------
create table public.counties (
  id          uuid primary key default gen_random_uuid(),
  cluster_id  uuid not null references public.clusters (id) on delete restrict,
  code        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  unique (cluster_id, name)
);
create index counties_cluster_idx on public.counties (cluster_id);

-- -----------------------------------------------------------------------------
-- supervisors / technicians: role-specific details; id == profiles.id
-- -----------------------------------------------------------------------------
create table public.supervisors (
  id            uuid primary key references public.profiles (id) on delete cascade,
  employee_code text unique,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null,
  updated_by    uuid references public.profiles (id) on delete set null
);

create table public.technicians (
  id            uuid primary key references public.profiles (id) on delete cascade,
  employee_code text unique,
  region_id     uuid references public.regions (id) on delete set null,
  supervisor_id uuid references public.supervisors (id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null,
  updated_by    uuid references public.profiles (id) on delete set null
);
create index technicians_region_idx on public.technicians (region_id);
create index technicians_supervisor_idx on public.technicians (supervisor_id);

-- -----------------------------------------------------------------------------
-- sites
-- region_id / cluster_id are kept consistent with county_id by trigger.
-- -----------------------------------------------------------------------------
create table public.sites (
  id                   uuid primary key default gen_random_uuid(),
  site_code            text not null unique,
  site_name            text not null,
  region_id            uuid not null references public.regions (id) on delete restrict,
  cluster_id           uuid references public.clusters (id) on delete restrict,
  county_id            uuid references public.counties (id) on delete restrict,
  latitude             double precision check (latitude between -90 and 90),
  longitude            double precision check (longitude between -180 and 180),
  address              text,
  site_type            text,
  power_configuration  text,
  generator_available  boolean not null default false,
  solar_available      boolean not null default false,
  battery_available    boolean not null default false,
  grid_available       boolean not null default false,
  status               public.site_status not null default 'ACTIVE',
  supervisor_id        uuid references public.supervisors (id) on delete set null,
  -- Optional per-site geofence override (metres); falls back to system setting.
  geofence_radius_m    integer check (geofence_radius_m is null or geofence_radius_m > 0),
  -- Demo/seed records are flagged so they are never presented as live data.
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.profiles (id) on delete set null,
  updated_by           uuid references public.profiles (id) on delete set null,
  constraint sites_coordinates_pair check ((latitude is null) = (longitude is null))
);
create index sites_region_idx on public.sites (region_id);
create index sites_cluster_idx on public.sites (cluster_id);
create index sites_county_idx on public.sites (county_id);
create index sites_supervisor_idx on public.sites (supervisor_id);
create index sites_status_idx on public.sites (status);
create index sites_name_lower_idx on public.sites (lower(site_name));

create or replace function private.sync_site_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cluster_id uuid;
  v_region_id  uuid;
begin
  if new.county_id is not null then
    select c.cluster_id, cl.region_id
      into v_cluster_id, v_region_id
      from public.counties c
      join public.clusters cl on cl.id = c.cluster_id
     where c.id = new.county_id;
    new.cluster_id := v_cluster_id;
    new.region_id  := v_region_id;
  elsif new.cluster_id is not null then
    select cl.region_id into v_region_id from public.clusters cl where cl.id = new.cluster_id;
    new.region_id := v_region_id;
  end if;
  return new;
end;
$$;

create trigger sync_site_hierarchy
  before insert or update of region_id, cluster_id, county_id on public.sites
  for each row execute function private.sync_site_hierarchy();

-- -----------------------------------------------------------------------------
-- site_assignments: which technician covers which site.
-- -----------------------------------------------------------------------------
create table public.site_assignments (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites (id) on delete cascade,
  technician_id  uuid not null references public.technicians (id) on delete cascade,
  starts_on      date not null default current_date,
  ends_on        date,
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles (id) on delete set null,
  updated_by     uuid references public.profiles (id) on delete set null,
  constraint site_assignments_dates check (ends_on is null or ends_on >= starts_on)
);
create unique index site_assignments_one_active_idx
  on public.site_assignments (site_id, technician_id) where is_active;
create index site_assignments_technician_idx on public.site_assignments (technician_id) where is_active;
create index site_assignments_site_idx on public.site_assignments (site_id);

-- -----------------------------------------------------------------------------
-- system_settings: admin-configurable key/value configuration
-- (geofence, DC thresholds, notification settings, ...).
-- -----------------------------------------------------------------------------
create table public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null
);

-- Defaults. No engineering thresholds are invented: DC high-load flags are
-- disabled (null) until an administrator configures them.
insert into public.system_settings (key, value, description) values
  ('geofence', '{"radius_m": 100, "mode": "WARN"}',
   'Default PM start geofence. mode: WARN | REQUIRE_REASON | BLOCK. Sites may override radius_m.'),
  ('dc_thresholds', '{"high_load_kw": null, "high_load_current_a": null}',
   'DC high-load flag thresholds. null = not configured (no flag raised).'),
  ('notifications', '{"pm_due_reminder_days": null, "corrective_action_overdue_enabled": true}',
   'Notification behaviour settings.');

-- Audit-column triggers
select private.attach_audit_trigger('public.regions');
select private.attach_audit_trigger('public.profiles');
select private.attach_audit_trigger('public.clusters');
select private.attach_audit_trigger('public.counties');
select private.attach_audit_trigger('public.supervisors');
select private.attach_audit_trigger('public.technicians');
select private.attach_audit_trigger('public.sites');
select private.attach_audit_trigger('public.site_assignments');
select private.attach_audit_trigger('public.system_settings');

-- =============================================================================
-- IPT PowerTech PM System — Foundation
-- Extensions, private schema, enumerations and shared trigger functions.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Functions used by RLS policies live in a schema that is NOT exposed through
-- the Supabase Data API (only `public` / `graphql_public` are exposed).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------

create type public.app_role as enum (
  'super_admin',
  'regional_manager',
  'regional_supervisor',
  'technician',
  'maintenance',
  'viewer'
);

-- PM schedule / PM visit lifecycle
create type public.pm_status as enum (
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'OVERDUE',
  'CANCELLED'
);

create type public.pm_frequency as enum (
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'BIMONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'AD_HOC'
);

create type public.priority_level as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
create type public.severity_level as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- The six PM sections of the reference report; also used as failure category.
create type public.pm_category as enum (
  'GENERATOR',
  'DC_SYSTEM',
  'BATTERY',
  'SOLAR',
  'NON_TECHNICAL',
  'EARTHING'
);

create type public.response_type as enum (
  'YES_NO_NA',
  'NUMBER',
  'TEXT',
  'SELECT',
  'MULTI_SELECT',
  'PHOTO',
  'DATE',
  'DATETIME'
);

create type public.yes_no_na as enum ('YES', 'NO', 'N/A');

create type public.failure_status as enum (
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'VERIFIED',
  'CLOSED'
);

create type public.failure_source as enum ('PM_CHECKLIST', 'MANUAL');

create type public.corrective_action_status as enum (
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'VERIFIED',
  'CLOSED'
);

create type public.site_status as enum ('ACTIVE', 'INACTIVE', 'DECOMMISSIONED');

create type public.template_status as enum ('DRAFT', 'ACTIVE', 'RETIRED');

create type public.gps_status as enum ('WITHIN_RADIUS', 'OUTSIDE_RADIUS', 'UNAVAILABLE', 'SITE_HAS_NO_COORDINATES');

create type public.geofence_mode as enum ('WARN', 'REQUIRE_REASON', 'BLOCK');

create type public.notification_type as enum (
  'PM_OVERDUE',
  'PM_COMPLETED',
  'PM_SUBMITTED',
  'PM_APPROVED',
  'PM_REJECTED',
  'PM_SCHEDULED',
  'PM_DUE',
  'SITE_ASSIGNED',
  'CRITICAL_FAILURE',
  'CORRECTIVE_ACTION_ASSIGNED',
  'CORRECTIVE_ACTION_OVERDUE',
  'CORRECTIVE_ACTION_COMPLETED'
);

-- -----------------------------------------------------------------------------
-- Shared trigger: maintain created_at/updated_at/created_by/updated_by.
-- created_* are immutable after insert.
-- -----------------------------------------------------------------------------
create or replace function private.set_audit_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := new.created_at;
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

-- Helper to attach the audit-column trigger to a table.
create or replace function private.attach_audit_trigger(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'create trigger set_audit_columns before insert or update on %s
       for each row execute function private.set_audit_columns()',
    p_table
  );
end;
$$;

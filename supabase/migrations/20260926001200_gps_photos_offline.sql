-- =============================================================================
-- Phase 5: GPS geofence, photo evidence integrity, offline sync support
-- =============================================================================

-- Haversine distance in metres. Mirrors distanceMeters() in @ipt/shared.
create or replace function private.distance_m(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision)
returns double precision
language sql immutable
set search_path = ''
as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

-- -----------------------------------------------------------------------------
-- GPS at PM start. The server recomputes distance and status from the site's
-- coordinates (the client's own evaluation is not trusted) and applies the
-- configured mode: WARN records, REQUIRE_REASON needs a reason, BLOCK rejects.
-- A site without coordinates cannot be verified and is never blocked.
-- -----------------------------------------------------------------------------
create or replace function private.check_visit_gps()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_site public.sites;
  v_setting jsonb;
  v_mode public.geofence_mode;
  v_radius integer;
begin
  select * into v_site from public.sites where id = new.site_id;
  select value into v_setting from public.system_settings where key = 'geofence';
  v_mode := coalesce((v_setting ->> 'mode')::public.geofence_mode, 'WARN');
  v_radius := coalesce(v_site.geofence_radius_m, (v_setting ->> 'radius_m')::integer, 100);

  new.geofence_mode := v_mode;
  new.gps_radius_m := v_radius;
  if new.gps_latitude is not null then
    new.gps_captured_at := coalesce(new.gps_captured_at, now());
  end if;

  if v_site.latitude is null or v_site.longitude is null then
    new.gps_status := 'SITE_HAS_NO_COORDINATES';
    new.gps_distance_m := null;
  elsif new.gps_latitude is null or new.gps_longitude is null then
    new.gps_status := 'UNAVAILABLE';
    new.gps_distance_m := null;
  else
    new.gps_distance_m := private.distance_m(new.gps_latitude, new.gps_longitude, v_site.latitude, v_site.longitude);
    new.gps_status := case when new.gps_distance_m > v_radius then 'OUTSIDE_RADIUS' else 'WITHIN_RADIUS' end;
  end if;

  if auth.uid() is not null and new.gps_status in ('OUTSIDE_RADIUS', 'UNAVAILABLE') then
    if v_mode = 'BLOCK' then
      raise exception '%', case when new.gps_status = 'UNAVAILABLE'
          then 'Your location is unavailable. PM cannot be started without GPS at this site.'
          else 'Technician is outside the configured site radius. PM cannot be started here.' end
        using errcode = '42501';
    elsif v_mode = 'REQUIRE_REASON' and coalesce(btrim(new.outside_radius_reason), '') = '' then
      raise exception 'Technician is outside the configured site radius. A reason is required to start PM.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger check_visit_gps
  before insert on public.pm_visits
  for each row execute function private.check_visit_gps();

-- GPS evidence is fixed once recorded (only a Super Admin may correct it).
create or replace function private.protect_visit_gps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.is_admin() and (
       new.gps_latitude is distinct from old.gps_latitude
    or new.gps_longitude is distinct from old.gps_longitude
    or new.gps_accuracy_m is distinct from old.gps_accuracy_m
    or new.gps_captured_at is distinct from old.gps_captured_at
    or new.gps_distance_m is distinct from old.gps_distance_m
    or new.gps_radius_m is distinct from old.gps_radius_m
    or new.gps_status is distinct from old.gps_status
    or new.geofence_mode is distinct from old.geofence_mode
    or new.outside_radius_reason is distinct from old.outside_radius_reason) then
    raise exception 'GPS check-in data cannot be changed after the PM has started' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_visit_gps
  before update on public.pm_visits
  for each row execute function private.protect_visit_gps();

-- -----------------------------------------------------------------------------
-- Photos: the metadata row is only accepted once the file is in storage, so
-- evidence counted for submission always exists. Upload first, then insert.
-- -----------------------------------------------------------------------------
create or replace function private.check_pm_photo_object()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from storage.objects o where o.bucket_id = new.bucket and o.name = new.file_path) then
    raise exception 'Photo file % has not been uploaded yet', new.file_path using errcode = '23503';
  end if;
  new.uploaded_at := coalesce(new.uploaded_at, now());
  return new;
end;
$$;

create trigger check_pm_photo_object
  before insert on public.pm_photos
  for each row execute function private.check_pm_photo_object();

-- -----------------------------------------------------------------------------
-- Offline download: everything a technician needs to work without a
-- connection, in one request. SECURITY INVOKER: every part is read under the
-- caller's RLS, so a technician only receives their own scope.
-- -----------------------------------------------------------------------------
create or replace function public.mobile_sync_bundle()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with open_visits as (
    select v.* from public.pm_visits v
     where v.technician_id = auth.uid()
       and v.status in ('IN_PROGRESS', 'COMPLETED', 'SUBMITTED', 'REJECTED')
  ),
  schedules as (
    select ps.* from public.pm_schedules ps
     where ps.technician_id = auth.uid()
       and ps.status in ('SCHEDULED', 'OVERDUE', 'IN_PROGRESS', 'REJECTED', 'COMPLETED')
  ),
  template_ids as (
    select id from public.pm_templates where status = 'ACTIVE'
    union select template_id from open_visits
    union select template_id from schedules
  )
  select jsonb_build_object(
    'generated_at', now(),
    'sites', coalesce((select jsonb_agg(to_jsonb(s) order by s.site_code) from public.site_overview s), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(to_jsonb(ps) order by ps.due_date) from schedules ps), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'sections', coalesce((
          select jsonb_agg(to_jsonb(s) || jsonb_build_object(
            'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order) from public.pm_checklist_items i where i.section_id = s.id), '[]'::jsonb),
            'fields', coalesce((select jsonb_agg(to_jsonb(f) order by f.sort_order) from public.pm_reading_fields f where f.section_id = s.id), '[]'::jsonb)
          ) order by s.sort_order)
            from public.pm_sections s where s.template_id = t.id), '[]'::jsonb)))
        from public.pm_templates t where t.id in (select id from template_ids)), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(to_jsonb(v) || jsonb_build_object(
        'responses', coalesce((select jsonb_agg(to_jsonb(r)) from public.pm_responses r where r.visit_id = v.id), '[]'::jsonb),
        'readings', coalesce((select jsonb_agg(to_jsonb(r)) from public.pm_readings r where r.visit_id = v.id), '[]'::jsonb),
        'photos', coalesce((select jsonb_agg(to_jsonb(p)) from public.pm_photos p where p.visit_id = v.id), '[]'::jsonb)))
        from open_visits v), '[]'::jsonb),
    'settings', coalesce((
      select jsonb_object_agg(key, value) from public.system_settings where key in ('geofence', 'pm_submission')), '{}'::jsonb),
    'consistency_rules', coalesce((
      select jsonb_agg(to_jsonb(r)) from public.pm_consistency_rules r where r.is_active), '[]'::jsonb)
  )
$$;

revoke execute on function public.mobile_sync_bundle() from public, anon;
grant execute on function public.mobile_sync_bundle() to authenticated;

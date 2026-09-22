-- =============================================================================
-- Phase 3: PM engine
--   * write-time validation of responses / readings (range, integer, options)
--   * server-computed completion % and failure count
--   * section N/A validation
--   * submission rules (required answers, required comments, required photos)
--   * visit <-> schedule linkage and status synchronisation, overdue marking
--   * template versioning (clone, activate; retired versions read-only)
-- =============================================================================

insert into public.system_settings (key, value, description) values
  ('pm_submission', '{"enforce_photo_requirements": true}',
   'PM submission rules. enforce_photo_requirements: block submission until required evidence photos exist.')
on conflict (key) do nothing;

-- One live (non-cancelled) visit per schedule.
create unique index pm_visits_one_per_schedule_idx
  on public.pm_visits (schedule_id)
  where schedule_id is not null and status <> 'CANCELLED';

-- -----------------------------------------------------------------------------
-- Value presence rules (shared by completion and submission checks).
-- Mirrored in packages/shared/src/pm/checklist.ts.
-- -----------------------------------------------------------------------------
create or replace function private.response_has_value(
  p_item public.pm_checklist_items,
  p_response public.pm_responses
)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p_response.id is null then false
    when p_response.answer = 'N/A' and p_item.allow_not_applicable then true
    else case p_item.response_type
      when 'YES_NO_NA'    then p_response.answer is not null
      when 'NUMBER'       then p_response.numeric_value is not null
      when 'TEXT'         then nullif(btrim(p_response.text_value), '') is not null
      when 'SELECT'       then nullif(btrim(p_response.text_value), '') is not null
      when 'MULTI_SELECT' then coalesce(cardinality(p_response.selected_options), 0) > 0
      when 'DATE'         then p_response.date_value is not null
      when 'DATETIME'     then p_response.datetime_value is not null
      when 'PHOTO'        then true -- a PHOTO item is answered by attaching a photo (checked separately)
      else false
    end
  end
$$;

create or replace function private.reading_has_value(
  p_field public.pm_reading_fields,
  p_reading public.pm_readings
)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p_reading.id is null then false
    when p_field.value_type = 'NUMBER' then p_reading.numeric_value is not null
    else nullif(btrim(p_reading.text_value), '') is not null
  end
$$;

-- -----------------------------------------------------------------------------
-- Checklist items / reading fields that apply to a visit (active, in sections
-- not marked N/A).
-- -----------------------------------------------------------------------------
-- Takes the template and N/A sections explicitly so it also works in a BEFORE
-- INSERT trigger, when the visit row does not exist yet.
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
  )
  -- Required answers
  select it.section_code, 'item', (it.i).id, (it.i).prompt, 'REQUIRED'
    from items it
   where (it.i).is_required and not private.response_has_value(it.i, it.resp)
     and (it.i).response_type <> 'PHOTO'
  union all
  -- Required comment (on failure, or on a configured answer)
  select it.section_code, 'item', (it.i).id, (it.i).prompt, 'COMMENT_REQUIRED'
    from items it
   where nullif(btrim((it.resp).comment), '') is null
     and ( (it.failed and (it.i).requires_comment_on_failure)
        or ((it.resp).answer is not null and (it.resp).answer = any ((it.i).requires_comment_on_answer)) )
  union all
  -- Required photo (PHOTO items, on failure, or on a configured answer)
  select it.section_code, 'item', (it.i).id, (it.i).prompt, 'PHOTO_REQUIRED'
    from items it
    left join item_photos ph on ph.checklist_item_id = (it.i).id
   where v_enforce_photos
     and coalesce(ph.n, 0) = 0
     and ( ((it.i).response_type = 'PHOTO' and (it.i).is_required)
        or (it.failed and (it.i).requires_photo_on_failure)
        or ((it.resp).answer is not null and (it.resp).answer = any ((it.i).requires_photo_on_answer)) )
  union all
  -- Required readings
  select s.code, 'reading', f.id, f.label, 'REQUIRED'
    from public.pm_reading_fields f
    join sections s on s.id = f.section_id
    left join public.pm_readings r on r.visit_id = p_visit_id and r.reading_field_id = f.id
   where f.is_active and f.is_required and not private.reading_has_value(f, r);
end;
$$;

create or replace function private.visit_issues(p_visit_id uuid)
returns table (section_code text, ref_type text, ref_id uuid, label text, issue text)
language sql stable security definer
set search_path = ''
as $$
  select i.*
    from public.pm_visits v,
         private.visit_issues_for(v.id, v.template_id, v.not_applicable_sections) i
   where v.id = p_visit_id
$$;

-- Public, RLS-aware wrapper for the apps (submit screen, review page).
create or replace function public.pm_visit_issues(p_visit_id uuid)
returns table (section_code text, ref_type text, ref_id uuid, label text, issue text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.can_read_visit(p_visit_id) then
    raise exception 'PM visit not found' using errcode = 'P0002';
  end if;
  return query select * from private.visit_issues(p_visit_id);
end;
$$;

revoke execute on function public.pm_visit_issues(uuid) from public, anon;
grant execute on function public.pm_visit_issues(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Completion % and failure count.
-- -----------------------------------------------------------------------------
create or replace function private.visit_progress(p_visit_id uuid, p_na_sections text[])
returns table (completion_pct numeric, failure_count integer)
language sql stable security definer
set search_path = ''
as $$
  with v as (select * from public.pm_visits where id = p_visit_id),
  sections as (
    select s.id from public.pm_sections s, v
     where s.template_id = v.template_id and s.is_active
       and not (s.code = any (coalesce(p_na_sections, '{}')))
  ),
  item_req as (
    select private.response_has_value(i, r) as done
      from public.pm_checklist_items i
      join sections s on s.id = i.section_id
      left join public.pm_responses r on r.visit_id = p_visit_id and r.checklist_item_id = i.id
     where i.is_active and i.is_required and i.response_type <> 'PHOTO'
  ),
  reading_req as (
    select private.reading_has_value(f, r) as done
      from public.pm_reading_fields f
      join sections s on s.id = f.section_id
      left join public.pm_readings r on r.visit_id = p_visit_id and r.reading_field_id = f.id
     where f.is_active and f.is_required
  ),
  req as (select done from item_req union all select done from reading_req)
  select
    case when (select count(*) from req) = 0 then 100::numeric
         else round(100.0 * (select count(*) filter (where done) from req) / (select count(*) from req), 2) end,
    ( select count(*)::int
        from public.pm_responses r
        join public.pm_checklist_items i on i.id = r.checklist_item_id
        join sections s on s.id = i.section_id
       where r.visit_id = p_visit_id and r.is_failure )
$$;

create or replace function private.refresh_visit_progress(p_visit_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_na text[];
  v_pct numeric;
  v_failures integer;
begin
  select not_applicable_sections into v_na from public.pm_visits where id = p_visit_id;
  if not found then
    return;
  end if;
  select completion_pct, failure_count into v_pct, v_failures from private.visit_progress(p_visit_id, v_na);
  -- System update: lets the guard accept the derived columns, then switches back.
  perform set_config('ipt.system_update', 'on', true);
  update public.pm_visits
     set completion_pct = v_pct, failure_count = v_failures
   where id = p_visit_id
     and (completion_pct is distinct from v_pct or failure_count is distinct from v_failures);
  perform set_config('ipt.system_update', 'off', true);
end;
$$;

create or replace function private.on_visit_data_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.refresh_visit_progress(case when tg_op = 'DELETE' then old.visit_id else new.visit_id end);
  return null;
end;
$$;

create trigger refresh_progress_responses
  after insert or update or delete on public.pm_responses
  for each row execute function private.on_visit_data_change();
create trigger refresh_progress_readings
  after insert or update or delete on public.pm_readings
  for each row execute function private.on_visit_data_change();

-- -----------------------------------------------------------------------------
-- Write-time validation of values (replaces the Phase 1 functions).
-- -----------------------------------------------------------------------------
create or replace function private.check_number(
  p_label text, p_value numeric, p_min numeric, p_max numeric, p_integer boolean
)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_value is null then
    return;
  end if;
  if p_min is not null and p_value < p_min then
    raise exception '"%" must be at least %', p_label, p_min using errcode = '23514';
  end if;
  if p_max is not null and p_value > p_max then
    raise exception '"%" must be at most %', p_label, p_max using errcode = '23514';
  end if;
  if p_integer and p_value <> trunc(p_value) then
    raise exception '"%" must be a whole number', p_label using errcode = '23514';
  end if;
end;
$$;

create or replace function private.check_options(p_label text, p_options jsonb, p_values text[])
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_values is null or jsonb_array_length(p_options) = 0 then
    return;
  end if;
  if exists (
    select 1 from unnest(p_values) v
     where v is not null and not (p_options ? v)
  ) then
    raise exception '"%" has a value that is not one of the configured options', p_label using errcode = '23514';
  end if;
end;
$$;

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
  if new.answer is not null and new.answer <> 'N/A' and v_item.response_type <> 'YES_NO_NA' then
    raise exception '"%" does not take a YES/NO answer', v_item.prompt using errcode = '23514';
  end if;

  if v_item.response_type = 'NUMBER' then
    perform private.check_number(v_item.prompt, new.numeric_value, v_item.min_value, v_item.max_value,
      coalesce((v_item.metadata ->> 'integer')::boolean, false));
  elsif v_item.response_type = 'SELECT' then
    perform private.check_options(v_item.prompt, v_item.options, array[new.text_value]);
  elsif v_item.response_type = 'MULTI_SELECT' then
    perform private.check_options(v_item.prompt, v_item.options, new.selected_options);
  end if;

  new.is_failure := (new.answer = 'NO'  and v_item.creates_failure_on_no)
                 or (new.answer = 'YES' and v_item.creates_failure_on_yes);
  new.answered_by := coalesce(auth.uid(), new.answered_by);
  new.answered_at := coalesce(new.answered_at, now());
  return new;
end;
$$;

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

  if v_field.value_type = 'NUMBER' then
    if new.text_value is not null then
      raise exception '"%" is a numeric reading', v_field.label using errcode = '23514';
    end if;
    perform private.check_number(v_field.label, new.numeric_value, v_field.min_value, v_field.max_value, v_field.is_integer);
  else
    if new.numeric_value is not null then
      raise exception '"%" is a text reading', v_field.label using errcode = '23514';
    end if;
    if v_field.value_type = 'SELECT' then
      perform private.check_options(v_field.label, v_field.options, array[new.text_value]);
    end if;
  end if;

  new.label_snapshot := v_field.label;
  new.unit_snapshot := v_field.unit;
  new.captured_at := coalesce(new.captured_at, now());
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Visit guard (replaces Phase 1): adds derived columns, template/schedule/N/A
-- validation and the submission check.
-- -----------------------------------------------------------------------------
create or replace function private.check_visit_structure(p_new public.pm_visits)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_bad text;
  v_schedule public.pm_schedules;
begin
  if exists (select 1 from public.pm_templates t where t.id = p_new.template_id and t.status = 'DRAFT') then
    raise exception 'A draft PM template cannot be used for a PM visit' using errcode = '23514';
  end if;

  select na.section_code into v_bad
    from unnest(p_new.not_applicable_sections) as na(section_code)
   where not exists (
     select 1 from public.pm_sections s
      where s.template_id = p_new.template_id and s.code = na.section_code and s.allow_not_applicable
   )
   limit 1;
  if v_bad is not null then
    raise exception 'Section % cannot be marked N/A', v_bad using errcode = '23514';
  end if;

  if p_new.schedule_id is not null then
    select * into v_schedule from public.pm_schedules where id = p_new.schedule_id;
    if v_schedule.site_id is distinct from p_new.site_id then
      raise exception 'The PM schedule belongs to a different site' using errcode = '23514';
    end if;
    if v_schedule.technician_id is not null and v_schedule.technician_id is distinct from p_new.technician_id then
      raise exception 'The PM schedule is assigned to another technician' using errcode = '23514';
    end if;
  end if;
end;
$$;

create or replace function private.assert_submittable(p_visit public.pm_visits)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from private.visit_issues_for(p_visit.id, p_visit.template_id, p_visit.not_applicable_sections);
  if v_count > 0 then
    raise exception 'Unable to submit because % required field% incomplete.',
      v_count, case when v_count = 1 then ' is' else 's are' end
      using errcode = '23514', hint = 'Call pm_visit_issues(visit_id) for the list.';
  end if;
end;
$$;

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
  c_tech_forbidden text[] := array['technician_id', 'site_id', 'template_id', 'schedule_id',
    'supervisor_id', 'reviewed_by', 'reviewed_at', 'review_comments', 'created_by', 'created_at',
    'completion_pct', 'failure_count', 'submitted_at'];
  c_review_allowed text[] := array['status', 'review_comments', 'reviewed_by', 'reviewed_at',
    'supervisor_id', 'updated_at', 'updated_by'];
begin
  -- Derived-column refresh by private.refresh_visit_progress().
  if tg_op = 'UPDATE' and current_setting('ipt.system_update', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.completion_pct := 0;
    new.failure_count := 0;
    perform private.check_visit_structure(new);
    if v_uid is null then
      return new;
    end if;
    if new.status not in ('IN_PROGRESS', 'COMPLETED', 'SUBMITTED') then
      raise exception 'A new PM visit must be IN_PROGRESS, COMPLETED or SUBMITTED' using errcode = '42501';
    end if;
    if new.reviewed_by is not null or new.reviewed_at is not null or new.review_comments is not null then
      raise exception 'Review fields cannot be set by the technician' using errcode = '42501';
    end if;
    new.supervisor_id := (select s.supervisor_id from public.sites s where s.id = new.site_id);
    new.started_at := coalesce(new.started_at, now());
    if new.status = 'SUBMITTED' then
      -- A brand-new visit has no answers yet, so this fails unless nothing is
      -- required. Offline sync therefore pushes the visit, then its answers,
      -- then the SUBMITTED status.
      perform private.assert_submittable(new);
      new.submitted_at := now();
    else
      new.submitted_at := null;
    end if;
    return new;
  end if;

  if new.not_applicable_sections is distinct from old.not_applicable_sections
     or new.schedule_id is distinct from old.schedule_id then
    perform private.check_visit_structure(new);
  end if;
  if new.not_applicable_sections is distinct from old.not_applicable_sections then
    select p.completion_pct, p.failure_count into new.completion_pct, new.failure_count
      from private.visit_progress(new.id, new.not_applicable_sections) p;
  end if;

  if v_uid is null then
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
     where (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k)
       and not (k in ('completion_pct', 'failure_count')
                and new.not_applicable_sections is distinct from old.not_applicable_sections);
    if v_changed_forbidden is not null then
      raise exception 'Technicians cannot change: %', array_to_string(v_changed_forbidden, ', ')
        using errcode = '42501';
    end if;
    if new.status = 'SUBMITTED' and old.status <> 'SUBMITTED' then
      perform private.assert_submittable(new);
      new.submitted_at := now();
      new.ended_at := coalesce(new.ended_at, now());
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

-- -----------------------------------------------------------------------------
-- Keep the schedule status in step with its visit.
-- -----------------------------------------------------------------------------
create or replace function private.sync_schedule_from_visit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status public.pm_status;
begin
  if new.schedule_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  v_status := case new.status
    when 'CANCELLED' then 'SCHEDULED'::public.pm_status
    else new.status end;
  update public.pm_schedules
     set status = case
           when v_status = 'SCHEDULED' and due_date < current_date then 'OVERDUE'::public.pm_status
           else v_status end
   where id = new.schedule_id and status <> 'CANCELLED';
  return null;
end;
$$;

create trigger sync_schedule_from_visit
  after insert or update of status on public.pm_visits
  for each row execute function private.sync_schedule_from_visit();

-- Scheduled job: SCHEDULED past due -> OVERDUE. Returns the number of rows.
create or replace function public.mark_overdue_schedules()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.pm_schedules set status = 'OVERDUE'
   where status = 'SCHEDULED' and due_date < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_overdue_schedules() from public, anon;
grant execute on function public.mark_overdue_schedules() to authenticated;

-- Run daily at 00:15 UTC when pg_cron is available (Supabase: enable "pg_cron").
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ipt-mark-overdue-pm', '15 0 * * *', 'select public.mark_overdue_schedules()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- Schedule integrity: template must be usable, technician must be assigned to
-- the site at creation time.
-- -----------------------------------------------------------------------------
create or replace function private.check_pm_schedule()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.pm_templates t where t.id = new.template_id and t.status <> 'ACTIVE')
     and (tg_op = 'INSERT' or new.template_id is distinct from old.template_id) then
    raise exception 'PM can only be scheduled with the ACTIVE template version' using errcode = '23514';
  end if;
  if new.technician_id is not null
     and (tg_op = 'INSERT' or new.technician_id is distinct from old.technician_id)
     and not exists (
       select 1 from public.technicians t join public.profiles p on p.id = t.id
        where t.id = new.technician_id and t.is_active and p.is_active and p.role = 'technician'
     ) then
    raise exception 'The technician account is not active' using errcode = '23514';
  end if;
  if new.technician_id is not null
     and (tg_op = 'INSERT' or new.technician_id is distinct from old.technician_id)
     and not exists (
       select 1 from public.site_assignments a
        where a.site_id = new.site_id and a.technician_id = new.technician_id and a.is_active
          and (a.ends_on is null or a.ends_on >= new.scheduled_date)
     ) then
    raise exception 'The technician is not assigned to this site' using errcode = '23514';
  end if;
  if new.supervisor_id is null then
    new.supervisor_id := (select s.supervisor_id from public.sites s where s.id = new.site_id);
  end if;
  return new;
end;
$$;

create trigger check_pm_schedule
  before insert or update on public.pm_schedules
  for each row execute function private.check_pm_schedule();

create trigger audit_pm_schedules after insert or update or delete on public.pm_schedules
  for each row execute function private.audit_row_change('PM_SCHEDULE');

-- -----------------------------------------------------------------------------
-- Template versioning
-- -----------------------------------------------------------------------------

-- Retired versions are frozen: history must reflect what technicians saw.
create or replace function private.guard_retired_template()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_template_id uuid;
  v_status public.template_status;
begin
  if tg_table_name = 'pm_sections' then
    v_template_id := coalesce(new.template_id, old.template_id);
  else
    select s.template_id into v_template_id
      from public.pm_sections s where s.id = coalesce(new.section_id, old.section_id);
  end if;
  select status into v_status from public.pm_templates where id = v_template_id;
  if v_status = 'RETIRED' then
    raise exception 'Retired template versions cannot be changed. Create a new version instead.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    new.deactivated_at := case when new.is_active then null else coalesce(old.deactivated_at, now()) end;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_retired_sections before insert or update or delete on public.pm_sections
  for each row execute function private.guard_retired_template();
create trigger guard_retired_items before insert or update or delete on public.pm_checklist_items
  for each row execute function private.guard_retired_template();
create trigger guard_retired_readings before insert or update or delete on public.pm_reading_fields
  for each row execute function private.guard_retired_template();

create or replace function public.admin_clone_template(p_template_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_src public.pm_templates;
  v_new_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Only a Super Admin can manage PM templates' using errcode = '42501';
  end if;
  select * into v_src from public.pm_templates where id = p_template_id;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;

  insert into public.pm_templates (code, name, version, status, description)
  values (v_src.code, v_src.name,
          (select max(version) + 1 from public.pm_templates where code = v_src.code),
          'DRAFT', v_src.description)
  returning id into v_new_id;

  create temporary table _section_map (old_id uuid, new_id uuid) on commit drop;
  with src as (
    select s.*, gen_random_uuid() as new_id from public.pm_sections s
     where s.template_id = p_template_id and s.is_active
  ), ins as (
    insert into public.pm_sections (id, template_id, code, name, category, sort_order, description,
                                    allow_not_applicable, applicable_site_flag)
    select new_id, v_new_id, code, name, category, sort_order, description, allow_not_applicable, applicable_site_flag
      from src
    returning id
  )
  insert into _section_map select id, new_id from src;

  insert into public.pm_reading_fields (section_id, code, label, value_type, unit, is_integer, min_value, max_value,
                                        options, is_required, help_text, analytics_key, sort_order)
  select m.new_id, f.code, f.label, f.value_type, f.unit, f.is_integer, f.min_value, f.max_value,
         f.options, f.is_required, f.help_text, f.analytics_key, f.sort_order
    from public.pm_reading_fields f join _section_map m on m.old_id = f.section_id
   where f.is_active;

  insert into public.pm_checklist_items (section_id, code, prompt, help_text, response_type, options,
    allow_not_applicable, is_required, unit, min_value, max_value, creates_failure_on_no, creates_failure_on_yes,
    failure_severity, requires_photo_on_failure, requires_comment_on_failure, requires_photo_on_answer,
    requires_comment_on_answer, photo_instructions, metadata, analytics_key, sort_order)
  select m.new_id, i.code, i.prompt, i.help_text, i.response_type, i.options,
    i.allow_not_applicable, i.is_required, i.unit, i.min_value, i.max_value, i.creates_failure_on_no,
    i.creates_failure_on_yes, i.failure_severity, i.requires_photo_on_failure, i.requires_comment_on_failure,
    i.requires_photo_on_answer, i.requires_comment_on_answer, i.photo_instructions, i.metadata, i.analytics_key,
    i.sort_order
    from public.pm_checklist_items i join _section_map m on m.old_id = i.section_id
   where i.is_active;

  return v_new_id;
end;
$$;

create or replace function public.admin_activate_template(p_template_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_admin() then
    raise exception 'Only a Super Admin can manage PM templates' using errcode = '42501';
  end if;
  select code into v_code from public.pm_templates where id = p_template_id;
  if v_code is null then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.pm_checklist_items i join public.pm_sections s on s.id = i.section_id
     where s.template_id = p_template_id and i.is_active and s.is_active
  ) then
    raise exception 'A template needs at least one active checklist item before activation' using errcode = '23514';
  end if;
  update public.pm_templates set status = 'RETIRED'
   where code = v_code and status = 'ACTIVE' and id <> p_template_id;
  update public.pm_templates set status = 'ACTIVE' where id = p_template_id;
  -- Open schedules move to the new version; started visits keep theirs.
  update public.pm_schedules ps set template_id = p_template_id
    from public.pm_templates t
   where t.id = ps.template_id and t.code = v_code and ps.template_id <> p_template_id
     and ps.status in ('SCHEDULED', 'OVERDUE');
end;
$$;

revoke execute on function public.admin_clone_template(uuid) from public, anon;
revoke execute on function public.admin_activate_template(uuid) from public, anon;
grant execute on function public.admin_clone_template(uuid) to authenticated;
grant execute on function public.admin_activate_template(uuid) to authenticated;

-- Direct status edits are still possible for a Super Admin; the partial unique
-- index pm_templates_one_active_idx guarantees at most one ACTIVE version.

-- -----------------------------------------------------------------------------
-- Views for list pages (RLS via security_invoker)
-- -----------------------------------------------------------------------------
create view public.pm_schedule_overview
with (security_invoker = true) as
select
  ps.id,
  ps.site_id,
  s.site_code,
  s.site_name,
  s.region_id,
  s.county_id,
  s.is_demo,
  ps.template_id,
  t.name as template_name,
  t.version as template_version,
  ps.technician_id,
  tp.full_name as technician_name,
  ps.supervisor_id,
  sp.full_name as supervisor_name,
  ps.frequency,
  ps.scheduled_date,
  ps.due_date,
  ps.status,
  (ps.status = 'OVERDUE' or (ps.status in ('SCHEDULED', 'IN_PROGRESS', 'REJECTED') and ps.due_date < current_date))
    as is_overdue,
  ps.priority,
  ps.notes,
  ( select v.id from public.pm_visits v
     where v.schedule_id = ps.id and v.status <> 'CANCELLED' limit 1 ) as visit_id,
  ps.created_at,
  ps.updated_at
from public.pm_schedules ps
join public.sites s on s.id = ps.site_id
join public.pm_templates t on t.id = ps.template_id
left join public.profiles tp on tp.id = ps.technician_id
left join public.profiles sp on sp.id = ps.supervisor_id;

create view public.pm_visit_overview
with (security_invoker = true) as
select
  v.id,
  v.schedule_id,
  v.site_id,
  s.site_code,
  s.site_name,
  s.region_id,
  s.county_id,
  v.template_id,
  t.version as template_version,
  v.technician_id,
  tp.full_name as technician_name,
  v.supervisor_id,
  sp.full_name as supervisor_name,
  v.status,
  v.started_at,
  v.ended_at,
  v.submitted_at,
  v.reviewed_at,
  rp.full_name as reviewed_by_name,
  v.review_comments,
  v.completion_pct,
  v.failure_count,
  v.gps_status,
  v.is_demo,
  v.created_at,
  v.updated_at
from public.pm_visits v
join public.sites s on s.id = v.site_id
join public.pm_templates t on t.id = v.template_id
left join public.profiles tp on tp.id = v.technician_id
left join public.profiles sp on sp.id = v.supervisor_id
left join public.profiles rp on rp.id = v.reviewed_by;

revoke all on public.pm_schedule_overview, public.pm_visit_overview from anon;
grant select on public.pm_schedule_overview, public.pm_visit_overview to authenticated;

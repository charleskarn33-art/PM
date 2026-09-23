-- =============================================================================
-- Phase 6: failures from submitted PMs, corrective-action workflow,
-- notifications (in-app + push tokens).
-- =============================================================================

-- Runs `p_sql`-style system writes: guards accept derived/system changes while
-- the flag is on. Callers save and restore the previous value so nested system
-- blocks never switch the flag off early.
create or replace function private.system_flag(p_on boolean)
returns text
language sql
set search_path = ''
as $$
  select set_config('ipt.system_update', case when p_on then 'on' else 'off' end, true)
$$;

-- -----------------------------------------------------------------------------
-- Failures: resolution note (closing without a corrective action) and a guard.
-- -----------------------------------------------------------------------------
alter table public.failures add column resolution_note text;

create trigger audit_failures after insert or update or delete on public.failures
  for each row execute function private.audit_row_change('FAILURE');
create trigger audit_corrective_actions after insert or update or delete on public.corrective_actions
  for each row execute function private.audit_row_change('CORRECTIVE_ACTION');

-- Users may record MANUAL failures, change severity/description, close a
-- failure with a note or reopen a closed one. Checklist failures and the
-- workflow statuses (ASSIGNED … VERIFIED) are maintained by the system.
create or replace function private.guard_failure()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if current_setting('ipt.system_update', true) = 'on' or v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.source <> 'MANUAL' then
      raise exception 'Checklist failures are created automatically when a PM is submitted' using errcode = '42501';
    end if;
    if new.status <> 'OPEN' then
      raise exception 'A new failure starts as OPEN' using errcode = '42501';
    end if;
    if coalesce(btrim(new.description), '') = '' then
      raise exception 'Describe the failure' using errcode = '23514';
    end if;
    if private.has_any_role('technician') then
      new.technician_id := v_uid;
    end if;
    new.detected_at := coalesce(new.detected_at, now());
    return new;
  end if;

  -- UPDATE
  if new.source is distinct from old.source or new.site_id is distinct from old.site_id
     or new.visit_id is distinct from old.visit_id or new.checklist_item_id is distinct from old.checklist_item_id
     or new.response_id is distinct from old.response_id or new.section_id is distinct from old.section_id
     or new.technician_id is distinct from old.technician_id or new.detected_at is distinct from old.detected_at
     or new.failure_number is distinct from old.failure_number then
    raise exception 'Only severity, description, category and closing details of a failure can be changed' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'CLOSED' then
      if coalesce(btrim(new.resolution_note), '') = '' then
        raise exception 'A note is required to close a failure' using errcode = '23514';
      end if;
      if exists (select 1 from public.corrective_actions ca
                  where ca.failure_id = new.id and ca.status not in ('VERIFIED', 'CLOSED')) then
        raise exception 'This failure has corrective actions in progress; finish or close them first' using errcode = '23514';
      end if;
      new.closed_at := now();
    elsif old.status = 'CLOSED' and new.status = 'OPEN' then
      new.closed_at := null;
      new.resolved_at := null;
      new.verified_at := null;
      new.verified_by := null;
    else
      raise exception 'Failure status follows its corrective actions; it can only be closed with a note or reopened'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_failure
  before insert or update on public.failures
  for each row execute function private.guard_failure();

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
-- dedupe_key: one notification per recipient and key (e.g. an overdue alert is
-- sent once per action and due date, however often the daily job runs).
alter table public.notifications add column dedupe_key text;
create unique index notifications_dedupe_idx on public.notifications (recipient_id, dedupe_key) where dedupe_key is not null;
create index notifications_push_pending_idx on public.notifications (created_at) where push_sent_at is null;

-- Sends a notification to each active recipient except the person who caused it.
create or replace function private.notify(
  p_recipients uuid[],
  p_type public.notification_type,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id uuid,
  p_dedupe_key text default null
)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, dedupe_key)
  select distinct r, p_type, p_title, p_body, p_entity_type, p_entity_id, p_dedupe_key
    from unnest(p_recipients) r
    join public.profiles p on p.id = r and p.is_active
   where r is not null and r is distinct from auth.uid()
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
$$;

-- Who supervises a site: its supervisor, else the active supervisors scoped to its region.
create or replace function private.site_supervisors(p_site_id uuid)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select array[s.supervisor_id] from public.sites s where s.id = p_site_id and s.supervisor_id is not null),
    (select array_agg(distinct u.profile_id)
       from public.user_region_scopes u
       join public.profiles p on p.id = u.profile_id and p.role = 'regional_supervisor' and p.is_active
       join public.sites s on s.region_id = u.region_id
      where s.id = p_site_id),
    '{}'::uuid[])
$$;

create or replace function private.site_managers(p_site_id uuid)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct u.profile_id), '{}'::uuid[])
    from public.user_region_scopes u
    join public.profiles p on p.id = u.profile_id and p.role = 'regional_manager' and p.is_active
    join public.sites s on s.region_id = u.region_id
   where s.id = p_site_id
$$;

create or replace function private.site_label(p_site_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select s.site_code || ' ' || s.site_name from public.sites s where s.id = p_site_id
$$;

-- -----------------------------------------------------------------------------
-- Failures from a submitted PM. One failure per visit + item (unique index),
-- so a resubmission updates rather than duplicates. A failure that is no
-- longer reported after resubmission is removed if nobody has acted on it yet.
-- -----------------------------------------------------------------------------
create or replace function private.sync_visit_failures(p_visit_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_visit public.pm_visits;
  v_prev text := coalesce(current_setting('ipt.system_update', true), 'off');
  r record;
begin
  select * into v_visit from public.pm_visits where id = p_visit_id;
  perform private.system_flag(true);

  for r in
    select resp.id as response_id, resp.answer, resp.comment, i.id as item_id, i.prompt, i.failure_severity,
           s.id as section_id, s.category
      from public.pm_responses resp
      join public.pm_checklist_items i on i.id = resp.checklist_item_id
      join public.pm_sections s on s.id = i.section_id
     where resp.visit_id = p_visit_id and resp.is_failure
       and not (s.code = any (v_visit.not_applicable_sections))
  loop
    insert into public.failures (source, site_id, visit_id, section_id, checklist_item_id, response_id, category,
                                 technician_id, detected_at, description, severity)
    values ('PM_CHECKLIST', v_visit.site_id, p_visit_id, r.section_id, r.item_id, r.response_id, r.category,
            v_visit.technician_id, coalesce(v_visit.submitted_at, now()),
            r.prompt || ' — answered ' || r.answer || coalesce(': ' || nullif(btrim(r.comment), ''), ''),
            r.failure_severity)
    on conflict (visit_id, checklist_item_id) where source = 'PM_CHECKLIST'
    do update set description = excluded.description, response_id = excluded.response_id
     where public.failures.status = 'OPEN';
  end loop;

  -- No longer reported (fixed after a rejection) and not yet worked on.
  for r in
    select f.id, f.failure_number from public.failures f
     where f.visit_id = p_visit_id and f.source = 'PM_CHECKLIST' and f.status = 'OPEN'
       and not exists (select 1 from public.corrective_actions ca where ca.failure_id = f.id)
       and not exists (
         select 1 from public.pm_responses resp
           join public.pm_checklist_items i on i.id = resp.checklist_item_id
           join public.pm_sections s on s.id = i.section_id
          where resp.visit_id = p_visit_id and resp.checklist_item_id = f.checklist_item_id and resp.is_failure
            and not (s.code = any (v_visit.not_applicable_sections)))
  loop
    delete from public.failures where id = r.id;
  end loop;

  perform set_config('ipt.system_update', v_prev, true);
end;
$$;

-- Critical failures alert the site supervisor and the regional managers.
create or replace function private.on_failure_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.severity = 'CRITICAL' and (tg_op = 'INSERT' or old.severity <> 'CRITICAL') then
    perform private.notify(
      private.site_supervisors(new.site_id) || private.site_managers(new.site_id),
      'CRITICAL_FAILURE',
      'Critical failure at ' || private.site_label(new.site_id),
      new.failure_number || ': ' || new.description,
      'failure', new.id, 'critical:' || new.id);
  end if;
  return null;
end;
$$;

create trigger on_failure_change
  after insert or update of severity on public.failures
  for each row execute function private.on_failure_change();

-- -----------------------------------------------------------------------------
-- Visit status → failures + notifications.
-- -----------------------------------------------------------------------------
create or replace function private.on_visit_status()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_site text := private.site_label(new.site_id);
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'SUBMITTED' then
    perform private.sync_visit_failures(new.id);
    perform private.notify(
      case when new.supervisor_id is not null then array[new.supervisor_id] else private.site_supervisors(new.site_id) end,
      'PM_SUBMITTED', 'PM submitted for review: ' || v_site,
      new.failure_count || ' failure(s) recorded.', 'pm_visit', new.id, null);
  elsif new.status = 'APPROVED' then
    perform private.notify(array[new.technician_id], 'PM_APPROVED', 'PM approved: ' || v_site,
      new.review_comments, 'pm_visit', new.id, null);
  elsif new.status = 'REJECTED' then
    perform private.notify(array[new.technician_id], 'PM_REJECTED', 'PM returned for correction: ' || v_site,
      new.review_comments, 'pm_visit', new.id, null);
  end if;
  return null;
end;
$$;

create trigger on_visit_status
  after insert or update of status on public.pm_visits
  for each row execute function private.on_visit_status();

-- -----------------------------------------------------------------------------
-- Schedules and assignments → notifications.
-- -----------------------------------------------------------------------------
create or replace function private.on_schedule_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_site text := private.site_label(new.site_id);
begin
  if new.technician_id is not null
     and (tg_op = 'INSERT' or new.technician_id is distinct from old.technician_id)
     and new.status in ('SCHEDULED', 'OVERDUE') then
    perform private.notify(array[new.technician_id], 'PM_SCHEDULED', 'PM scheduled: ' || v_site,
      'Due ' || to_char(new.due_date, 'DD Mon YYYY') || '.', 'pm_schedule', new.id, null);
  end if;
  if tg_op = 'UPDATE' and new.status = 'OVERDUE' and old.status is distinct from 'OVERDUE' then
    perform private.notify(array[new.technician_id] || private.site_supervisors(new.site_id), 'PM_OVERDUE',
      'PM overdue: ' || v_site, 'Was due ' || to_char(new.due_date, 'DD Mon YYYY') || '.', 'pm_schedule', new.id,
      'pm_overdue:' || new.id || ':' || new.due_date);
  end if;
  return null;
end;
$$;

create trigger on_schedule_change
  after insert or update of technician_id, status on public.pm_schedules
  for each row execute function private.on_schedule_change();

create or replace function private.on_site_assignment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.notify(array[new.technician_id], 'SITE_ASSIGNED',
    'Site assigned to you: ' || private.site_label(new.site_id), null, 'site', new.site_id, null);
  return null;
end;
$$;

create trigger on_site_assignment
  after insert on public.site_assignments
  for each row execute function private.on_site_assignment();

-- -----------------------------------------------------------------------------
-- Corrective actions
-- -----------------------------------------------------------------------------
-- From a failure: site, visit and category come from the failure. The
-- assignee must be an active technician, maintenance user, supervisor or admin.
create or replace function private.prepare_corrective_action()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_failure public.failures;
begin
  if new.failure_id is not null and (tg_op = 'INSERT' or new.failure_id is distinct from old.failure_id) then
    select * into v_failure from public.failures where id = new.failure_id;
    if not found then
      raise exception 'Failure not found' using errcode = '23503';
    end if;
    new.site_id := v_failure.site_id;
    new.visit_id := coalesce(new.visit_id, v_failure.visit_id);
    new.category := v_failure.category;
  end if;
  if coalesce(btrim(new.description), '') = '' then
    raise exception 'Describe the corrective action' using errcode = '23514';
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles p
                      where p.id = new.assigned_to and p.is_active
                        and p.role in ('technician', 'maintenance', 'regional_supervisor', 'super_admin')) then
    raise exception 'Corrective actions can only be assigned to an active technician, maintenance user or supervisor'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Runs before the workflow guard (trigger names sort alphabetically).
create trigger a_prepare_corrective_action
  before insert or update on public.corrective_actions
  for each row execute function private.prepare_corrective_action();

-- Failure status follows its corrective actions: the least advanced one wins.
create or replace function private.refresh_failure_status(p_failure_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rank integer;
  v_status public.failure_status;
  v_prev text := coalesce(current_setting('ipt.system_update', true), 'off');
  c_map public.failure_status[] := array['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED'];
begin
  if p_failure_id is null then
    return;
  end if;
  select min(array_position(array['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED']::public.corrective_action_status[], ca.status))
    into v_rank
    from public.corrective_actions ca where ca.failure_id = p_failure_id;
  if v_rank is null then
    return;
  end if;
  v_status := c_map[v_rank];
  perform private.system_flag(true);
  update public.failures f
     set status = v_status,
         resolved_at = case when v_rank >= 4 then coalesce(f.resolved_at, now()) else null end,
         verified_at = case when v_rank >= 5 then coalesce(f.verified_at, now()) else null end,
         verified_by = case when v_rank >= 5 then coalesce(f.verified_by, auth.uid()) else null end,
         closed_at   = case when v_rank >= 6 then coalesce(f.closed_at, now()) else null end
   where f.id = p_failure_id and f.status is distinct from v_status;
  perform set_config('ipt.system_update', v_prev, true);
end;
$$;

create or replace function private.on_corrective_action_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_site text;
begin
  if tg_op = 'DELETE' then
    perform private.refresh_failure_status(old.failure_id);
    return null;
  end if;
  v_site := private.site_label(new.site_id);
  perform private.refresh_failure_status(new.failure_id);
  if tg_op = 'UPDATE' and old.failure_id is distinct from new.failure_id then
    perform private.refresh_failure_status(old.failure_id);
  end if;

  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform private.notify(array[new.assigned_to], 'CORRECTIVE_ACTION_ASSIGNED',
      'Corrective action assigned: ' || v_site,
      new.action_number || ': ' || new.description || coalesce(' (due ' || to_char(new.due_date, 'DD Mon YYYY') || ')', ''),
      'corrective_action', new.id, null);
  elsif tg_op = 'UPDATE' and old.status = 'COMPLETED' and new.status in ('ASSIGNED', 'IN_PROGRESS') then
    perform private.notify(array[new.assigned_to], 'CORRECTIVE_ACTION_ASSIGNED',
      'Corrective action returned: ' || v_site, new.action_number || ' needs more work.', 'corrective_action', new.id, null);
  end if;
  if tg_op = 'UPDATE' and new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED' then
    perform private.notify(private.site_supervisors(new.site_id) || array[new.assigned_by], 'CORRECTIVE_ACTION_COMPLETED',
      'Corrective action completed: ' || v_site, new.action_number || ': ' || coalesce(new.resolution, ''),
      'corrective_action', new.id, null);
  end if;
  return null;
end;
$$;

create trigger on_corrective_action_change
  after insert or update or delete on public.corrective_actions
  for each row execute function private.on_corrective_action_change();

-- Supervisors may send a completed action back to the assignee (with a note on
-- the timeline) instead of verifying it.
create or replace function public.return_corrective_action(p_action_id uuid, p_note text)
returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Explain what still needs to be done' using errcode = '23514';
  end if;
  update public.corrective_actions set status = 'IN_PROGRESS' where id = p_action_id and status = 'COMPLETED';
  if not found then
    raise exception 'Only a completed corrective action you manage can be returned' using errcode = '42501';
  end if;
  insert into public.corrective_action_updates (corrective_action_id, note) values (p_action_id, btrim(p_note));
end;
$$;
revoke execute on function public.return_corrective_action(uuid, text) from public, anon;
grant execute on function public.return_corrective_action(uuid, text) to authenticated;

-- Only managers may move a corrective action backwards (the guard lets
-- assignees move forward only); returning must go through the RPC above so a
-- note is always recorded.

-- -----------------------------------------------------------------------------
-- Daily reminders (pg_cron): PM due soon and overdue corrective actions,
-- controlled by system_settings.notifications. Nothing is sent when a setting
-- is not configured.
-- -----------------------------------------------------------------------------
create or replace function public.run_daily_notifications()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_setting jsonb;
  v_days integer;
  v_count integer := 0;
  r record;
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select value into v_setting from public.system_settings where key = 'notifications';
  v_days := (v_setting ->> 'pm_due_reminder_days')::integer;

  if v_days is not null then
    for r in
      select ps.* from public.pm_schedules ps
       where ps.status = 'SCHEDULED' and ps.technician_id is not null
         and ps.due_date between current_date and current_date + v_days
    loop
      perform private.notify(array[r.technician_id], 'PM_DUE', 'PM due soon: ' || private.site_label(r.site_id),
        'Due ' || to_char(r.due_date, 'DD Mon YYYY') || '.', 'pm_schedule', r.id, 'pm_due:' || r.id || ':' || r.due_date);
      v_count := v_count + 1;
    end loop;
  end if;

  if coalesce((v_setting ->> 'corrective_action_overdue_enabled')::boolean, false) then
    for r in
      select ca.* from public.corrective_actions ca
       where ca.status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS') and ca.due_date < current_date
    loop
      perform private.notify(array[r.assigned_to] || private.site_supervisors(r.site_id), 'CORRECTIVE_ACTION_OVERDUE',
        'Corrective action overdue: ' || private.site_label(r.site_id),
        r.action_number || ' was due ' || to_char(r.due_date, 'DD Mon YYYY') || '.', 'corrective_action', r.id,
        'ca_overdue:' || r.id || ':' || r.due_date);
      v_count := v_count + 1;
    end loop;
  end if;
  return v_count;
end;
$$;
revoke execute on function public.run_daily_notifications() from public, anon;
grant execute on function public.run_daily_notifications() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ipt-daily-notifications', '30 6 * * *', 'select public.run_daily_notifications()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end;
$$;

-- Mark all of the caller's notifications read.
create or replace function public.mark_all_notifications_read()
returns integer
language sql security invoker
set search_path = ''
as $$
  with u as (
    update public.notifications set read_at = now()
     where recipient_id = auth.uid() and read_at is null
    returning 1)
  select count(*)::int from u
$$;
revoke execute on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- -----------------------------------------------------------------------------
-- Push notifications: Expo push tokens per device. Sending happens in the
-- `send-push` Edge Function with the service role (server side only).
-- -----------------------------------------------------------------------------
create table public.push_tokens (
  token        text primary key,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_profile_idx on public.push_tokens (profile_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;
create policy push_tokens_own_select on public.push_tokens
  for select to authenticated using (profile_id = (select auth.uid()));
create policy push_tokens_own_delete on public.push_tokens
  for delete to authenticated using (profile_id = (select auth.uid()));

-- A device token moves to whoever signed in on that device last.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Not an Expo push token' using errcode = '22023';
  end if;
  insert into public.push_tokens (token, profile_id, platform)
  values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set profile_id = excluded.profile_id, platform = excluded.platform, last_seen_at = now();
end;
$$;
revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns void
language sql security invoker
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and profile_id = auth.uid()
$$;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Views for the web lists (RLS applies through security_invoker).
-- -----------------------------------------------------------------------------
create or replace view public.failure_overview
with (security_invoker = true) as
select f.id, f.failure_number, f.source, f.status, f.severity, f.category, f.description, f.resolution_note,
       f.detected_at, f.resolved_at, f.verified_at, f.closed_at,
       f.site_id, s.site_code, s.site_name, s.region_id, r.name as region_name, s.is_demo,
       f.visit_id, f.checklist_item_id, i.prompt as item_prompt,
       f.technician_id, tp.full_name as technician_name,
       (select count(*)::int from public.corrective_actions ca where ca.failure_id = f.id) as action_count,
       (select count(*)::int from public.corrective_actions ca
         where ca.failure_id = f.id and ca.status not in ('VERIFIED', 'CLOSED')) as open_action_count
  from public.failures f
  join public.sites s on s.id = f.site_id
  left join public.regions r on r.id = s.region_id
  left join public.pm_checklist_items i on i.id = f.checklist_item_id
  left join public.profiles tp on tp.id = f.technician_id;

create or replace view public.corrective_action_overview
with (security_invoker = true) as
select ca.id, ca.action_number, ca.status, ca.priority, ca.category, ca.description, ca.resolution,
       ca.due_date, ca.assigned_at, ca.completed_at, ca.verified_at, ca.closed_at, ca.created_at,
       (ca.status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS') and ca.due_date < current_date) as is_overdue,
       ca.site_id, s.site_code, s.site_name, s.region_id, r.name as region_name, s.is_demo,
       ca.failure_id, f.failure_number, f.severity as failure_severity,
       ca.visit_id,
       ca.assigned_to, ap.full_name as assignee_name, ap.role as assignee_role,
       ca.assigned_by, bp.full_name as assigned_by_name,
       ca.verified_by, vp.full_name as verified_by_name
  from public.corrective_actions ca
  join public.sites s on s.id = ca.site_id
  left join public.regions r on r.id = s.region_id
  left join public.failures f on f.id = ca.failure_id
  left join public.profiles ap on ap.id = ca.assigned_to
  left join public.profiles bp on bp.id = ca.assigned_by
  left join public.profiles vp on vp.id = ca.verified_by;

grant select on public.failure_overview, public.corrective_action_overview to authenticated;

-- People a manager may assign corrective actions to for a site: technicians
-- assigned to the site, maintenance users, and the site's supervisors.
create or replace function public.corrective_action_assignees(p_site_id uuid)
returns table (id uuid, full_name text, role public.app_role)
language sql stable security definer
set search_path = ''
as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email), p.role
    from public.profiles p
   where private.can_manage_site(p_site_id)
     and p.is_active
     and (
       (p.role = 'technician' and exists (
          select 1 from public.site_assignments a
           where a.site_id = p_site_id and a.technician_id = p.id and a.is_active
             and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)))
       or p.role = 'maintenance'
       or p.id = any (private.site_supervisors(p_site_id))
     )
   order by p.role, 2
$$;
revoke execute on function public.corrective_action_assignees(uuid) from public, anon;
grant execute on function public.corrective_action_assignees(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Offline download: add the caller's corrective actions (with timeline and
-- photos) and recent notifications.
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
  ),
  actions as (
    select ca.* from public.corrective_actions ca
     where ca.assigned_to = auth.uid()
       and (ca.status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
            or ca.updated_at > now() - interval '14 days')
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
    'actions', coalesce((
      select jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'site_code', s.site_code, 'site_name', s.site_name,
        'failure_number', f.failure_number, 'failure_description', f.description, 'failure_severity', f.severity,
        'updates', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'from_status', u.from_status, 'to_status', u.to_status,
                                                                 'note', u.note, 'created_at', u.created_at,
                                                                 'author_name', coalesce(nullif(ap.full_name, ''), ap.email))
                                               order by u.created_at)
                               from public.corrective_action_updates u
                               left join public.profiles ap on ap.id = u.author_id
                              where u.corrective_action_id = a.id), '[]'::jsonb),
        'photos', coalesce((select jsonb_agg(to_jsonb(p)) from public.pm_photos p where p.corrective_action_id = a.id), '[]'::jsonb))
        order by a.due_date nulls last, a.created_at)
        from actions a
        join public.sites s on s.id = a.site_id
        left join public.failures f on f.id = a.failure_id), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
        from (select * from public.notifications where recipient_id = auth.uid() order by created_at desc limit 50) n), '[]'::jsonb),
    'settings', coalesce((
      select jsonb_object_agg(key, value) from public.system_settings
       where key in ('geofence', 'pm_submission', 'dc_thresholds')), '{}'::jsonb),
    'consistency_rules', coalesce((
      select jsonb_agg(to_jsonb(r)) from public.pm_consistency_rules r where r.is_active), '[]'::jsonb)
  )
$$;

-- Whether the caller manages a site (supervisor in scope or admin). The UI uses
-- it to decide which controls to show; the database still enforces every write.
create or replace function public.can_manage_site(p_site_id uuid)
returns boolean
language sql stable security invoker
set search_path = ''
as $$
  select private.can_manage_site(p_site_id)
$$;
revoke execute on function public.can_manage_site(uuid) from public, anon;
grant execute on function public.can_manage_site(uuid) to authenticated;

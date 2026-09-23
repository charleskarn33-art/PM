-- =============================================================================
-- Phase 8: audit log detail and protection.
-- =============================================================================

-- Values longer than this are shortened in the audit record (the row itself
-- keeps the full value); keeps the log readable and bounded.
create or replace function private.audit_value(p jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p) = 'string' and length(p #>> '{}') > 300 then to_jsonb(left(p #>> '{}', 300) || '…')
    when jsonb_typeof(p) in ('object', 'array') and length(p::text) > 1000 then to_jsonb(left(p::text, 1000) || '…')
    else p end
$$;

-- Row changes now record what changed, not only which columns:
--   INSERT: the new row's identifying fields
--   UPDATE: { changes: { column: { from, to } } }
--   DELETE: a snapshot of the removed row
create or replace function private.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text := tg_argv[0];
  v_id uuid;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_meta jsonb;
  c_ignore text[] := array['updated_at', 'updated_by', 'created_at', 'created_by'];
  c_label text[] := array['code', 'name', 'site_code', 'site_name', 'failure_number', 'action_number', 'key', 'prompt', 'label',
                          'status', 'site_id', 'technician_id', 'region_id', 'due_date', 'severity', 'version'];
begin
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  if tg_op = 'UPDATE' then
    select jsonb_build_object('changes', coalesce(jsonb_object_agg(n.key,
             jsonb_build_object('from', private.audit_value(v_old -> n.key), 'to', private.audit_value(n.value))), '{}'::jsonb))
      into v_meta
      from jsonb_each(v_new) n
     where n.value is distinct from (v_old -> n.key)
       and not (n.key = any (c_ignore));
    if v_meta -> 'changes' = '{}'::jsonb then
      return null; -- nothing meaningful changed (e.g. only updated_at)
    end if;
  elsif tg_op = 'INSERT' then
    select jsonb_build_object('record', coalesce(jsonb_object_agg(k, private.audit_value(v_new -> k)), '{}'::jsonb))
      into v_meta
      from unnest(c_label) k
     where v_new ? k and v_new -> k <> 'null'::jsonb;
  else
    select jsonb_build_object('deleted', coalesce(jsonb_object_agg(e.key, private.audit_value(e.value)), '{}'::jsonb))
      into v_meta
      from jsonb_each(v_old) e
     where not (e.key = any (c_ignore));
  end if;
  perform private.write_audit_log(v_action || '_' || tg_op, tg_table_name, v_id, v_meta);
  return null;
end;
$$;

-- The audit log is append-only for everyone using the database, including
-- server-side code: existing entries cannot be edited or deleted.
create or replace function private.protect_audit_log()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit log entries cannot be changed or deleted' using errcode = '42501';
end;
$$;

create trigger protect_audit_log
  before update or delete on public.audit_logs
  for each row execute function private.protect_audit_log();

-- Audit entries with the actor's name and role (Super Admin only, via RLS).
create or replace view public.audit_log_overview
with (security_invoker = true) as
select a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.metadata,
       a.actor_id, coalesce(nullif(p.full_name, ''), p.email) as actor_name, p.email as actor_email, p.role as actor_role
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id;

grant select on public.audit_log_overview to authenticated;

create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- Distinct actions and entity types for the audit log filters.
create or replace function public.audit_log_facets()
returns table (kind text, value text)
language sql stable security invoker
set search_path = ''
as $$
  select 'action', action from (select distinct action from public.audit_logs) a
  union all
  select 'entity', entity_type from (select distinct entity_type from public.audit_logs where entity_type is not null) e
  order by 1, 2
$$;
revoke execute on function public.audit_log_facets() from public, anon;
grant execute on function public.audit_log_facets() to authenticated;

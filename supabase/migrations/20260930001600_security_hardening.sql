-- =============================================================================
-- Phase 9: privilege hardening (security review).
--
-- Supabase's default grants give `authenticated` every table privilege. RLS
-- limits SELECT/INSERT/UPDATE/DELETE, but TRUNCATE is not subject to RLS or
-- row triggers (it would bypass, for example, the audit log's append-only
-- guard), and REFERENCES / TRIGGER are never needed by app users. None of
-- these are reachable through the Data API today; they are removed so the
-- database does not depend on that.
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  loop
    execute format('revoke truncate, references, trigger on public.%I from authenticated, anon', r.relname);
    -- Views are read-only (none is auto-updatable); keep only SELECT.
    if r.relkind in ('v', 'm') then
      execute format('revoke insert, update, delete on public.%I from authenticated, anon', r.relname);
    end if;
  end loop;
end;
$$;

-- Numbering sequences: users only need nextval() through the column defaults;
-- reading or resetting them (setval) is not theirs to do.
revoke select, update on sequence public.failure_number_seq, public.corrective_action_number_seq from authenticated, anon;
grant usage on sequence public.failure_number_seq, public.corrective_action_number_seq to authenticated;

-- Tables and sequences created by later migrations start from the same baseline.
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
alter default privileges in schema public revoke select, update on sequences from authenticated;

-- Report audit entries: any active user can record one, so bound what they
-- can write into the append-only log (filters are shortened like other values).
create or replace function public.record_report_generated(
  p_report text,
  p_filters jsonb default '{}'::jsonb,
  p_row_count integer default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform private.write_audit_log('REPORT_GENERATED', 'report', null,
    jsonb_build_object('report', left(p_report, 64),
                       'filters', private.audit_value(coalesce(p_filters, '{}'::jsonb)),
                       'rows', p_row_count));
end;
$$;

-- Photo evidence: the uploader may retry (upsert) a file only until its
-- pm_photos row is recorded. After that the file is evidence and cannot be
-- replaced (before, the uploader could overwrite it even after submission).
create or replace function private.photo_object_recorded(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.pm_photos p where p.file_path = p_name or p.thumbnail_path = p_name)
$$;

drop policy pm_photos_objects_update on storage.objects;
create policy pm_photos_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pm-photos'
    and owner_id = (select auth.uid())::text
    and not private.photo_object_recorded(name)
  )
  with check (
    bucket_id = 'pm-photos'
    and owner_id = (select auth.uid())::text
    and private.try_uuid((storage.foldername(name))[1]) in (select private.accessible_site_ids())
  );

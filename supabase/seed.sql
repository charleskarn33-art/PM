-- =============================================================================
-- DEMO DATA — local development only (`supabase db reset`). Never run in
-- production. Every demo record is flagged is_demo = true.
--
-- Source: Tienii (1301) Preventative Maintenance Report, 2026-09-15.
--   Region: Grand Cape Mount | Site: Tienii | Site code: 1301
--   Technician: Abraham Cole (create the auth user, then see docs/SETUP.md)
--
-- Cluster, county and GPS coordinates are intentionally left empty: they are not
-- established by the information available at seeding time and must not be
-- invented. The demo PM visit and its recorded readings will be seeded in
-- Phase 3/4 once the reference report values are transcribed.
-- =============================================================================

insert into public.regions (code, name)
values ('GCM', 'Grand Cape Mount')
on conflict (code) do nothing;

insert into public.sites (
  site_code, site_name, region_id, status, is_demo
)
select '1301', 'Tienii', r.id, 'ACTIVE', true
  from public.regions r
 where r.code = 'GCM'
on conflict (site_code) do nothing;

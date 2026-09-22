-- =============================================================================
-- Supabase Storage buckets and object policies.
--
-- Path convention (both buckets): <site_id>/<...>/<file>
--   pm-photos:       <site_id>/<visit_id | 'ca-' || action_id>/<photo_id>.jpg
--   site-documents:  <site_id>/<document_id>-<filename>
-- The first path segment is the site id; access follows site access.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('pm-photos', 'pm-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('site-documents', 'site-documents', false, 26214400,
   array['application/pdf', 'image/jpeg', 'image/png',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/csv'])
on conflict (id) do nothing;

-- ---- pm-photos --------------------------------------------------------------
create policy pm_photos_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pm-photos'
    and (
      (select private.is_org_wide_reader())
      or private.try_uuid((storage.foldername(name))[1]) in (select private.accessible_site_ids())
    )
  );

-- Field roles that capture evidence may upload into sites they can access.
create policy pm_photos_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pm-photos'
    and (select private.has_any_role('technician', 'maintenance', 'regional_supervisor', 'super_admin'))
    and private.try_uuid((storage.foldername(name))[1]) in (select private.accessible_site_ids())
  );

-- Upload retries (upsert) by the original uploader only.
create policy pm_photos_objects_update on storage.objects
  for update to authenticated
  using (bucket_id = 'pm-photos' and owner_id = (select auth.uid())::text)
  with check (
    bucket_id = 'pm-photos'
    and owner_id = (select auth.uid())::text
    and private.try_uuid((storage.foldername(name))[1]) in (select private.accessible_site_ids())
  );

-- Evidence is not deletable except by Super Admin.
create policy pm_photos_objects_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'pm-photos' and (select private.is_admin()));

-- ---- site-documents ---------------------------------------------------------
create policy site_documents_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'site-documents'
    and (
      (select private.is_org_wide_reader())
      or private.try_uuid((storage.foldername(name))[1]) in (select private.accessible_site_ids())
    )
  );
create policy site_documents_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'site-documents'
    and private.can_manage_site(private.try_uuid((storage.foldername(name))[1]))
  );
create policy site_documents_objects_update on storage.objects
  for update to authenticated
  using (bucket_id = 'site-documents' and private.can_manage_site(private.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'site-documents' and private.can_manage_site(private.try_uuid((storage.foldername(name))[1])));
create policy site_documents_objects_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-documents' and private.can_manage_site(private.try_uuid((storage.foldername(name))[1])));

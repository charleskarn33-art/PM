-- =============================================================================
-- Failures, corrective actions, photos, notifications, audit log, site
-- documents and equipment.
-- =============================================================================

-- Human-readable reference numbers (FL-000001, CA-000001).
create sequence public.failure_number_seq;
create sequence public.corrective_action_number_seq;

-- -----------------------------------------------------------------------------
-- failures
-- -----------------------------------------------------------------------------
create table public.failures (
  id                 uuid primary key default gen_random_uuid(),
  failure_number     text not null unique
                       default 'FL-' || lpad(nextval('public.failure_number_seq')::text, 6, '0'),
  source             public.failure_source not null default 'PM_CHECKLIST',
  site_id            uuid not null references public.sites (id) on delete restrict,
  visit_id           uuid references public.pm_visits (id) on delete set null,
  section_id         uuid references public.pm_sections (id) on delete restrict,
  checklist_item_id  uuid references public.pm_checklist_items (id) on delete restrict,
  response_id        uuid references public.pm_responses (id) on delete set null,
  category           public.pm_category not null,
  technician_id      uuid references public.technicians (id) on delete set null,
  detected_at        timestamptz not null default now(),
  description        text not null,
  severity           public.severity_level not null default 'MEDIUM',
  status             public.failure_status not null default 'OPEN',
  resolved_at        timestamptz,
  verified_by        uuid references public.profiles (id) on delete set null,
  verified_at        timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  updated_by         uuid references public.profiles (id) on delete set null,
  constraint failures_checklist_source check (
    source <> 'PM_CHECKLIST' or (visit_id is not null and checklist_item_id is not null)
  )
);
-- One auto-created failure per visit + checklist item: repeated sync attempts
-- cannot create duplicates.
create unique index failures_visit_item_unique_idx
  on public.failures (visit_id, checklist_item_id)
  where source = 'PM_CHECKLIST';
create index failures_site_idx on public.failures (site_id, detected_at desc);
create index failures_status_idx on public.failures (status);
create index failures_category_idx on public.failures (category, detected_at desc);
create index failures_severity_idx on public.failures (severity) where status not in ('VERIFIED', 'CLOSED');

-- -----------------------------------------------------------------------------
-- corrective_actions
-- -----------------------------------------------------------------------------
create table public.corrective_actions (
  id              uuid primary key default gen_random_uuid(),
  action_number   text not null unique
                    default 'CA-' || lpad(nextval('public.corrective_action_number_seq')::text, 6, '0'),
  failure_id      uuid references public.failures (id) on delete set null,
  site_id         uuid not null references public.sites (id) on delete restrict,
  visit_id        uuid references public.pm_visits (id) on delete set null,
  category        public.pm_category not null,
  description     text not null,
  priority        public.priority_level not null default 'MEDIUM',
  assigned_to     uuid references public.profiles (id) on delete set null,
  assigned_by     uuid references public.profiles (id) on delete set null,
  assigned_at     timestamptz,
  due_date        date,
  status          public.corrective_action_status not null default 'OPEN',
  resolution      text,
  completed_at    timestamptz,
  verified_by     uuid references public.profiles (id) on delete set null,
  verified_at     timestamptz,
  closed_at       timestamptz,
  -- Offline sync: technicians may record on-site corrective actions offline.
  client_updated_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null,
  updated_by      uuid references public.profiles (id) on delete set null
);
create index corrective_actions_site_idx on public.corrective_actions (site_id);
create index corrective_actions_failure_idx on public.corrective_actions (failure_id);
create index corrective_actions_assignee_idx on public.corrective_actions (assigned_to, status);
create index corrective_actions_status_due_idx on public.corrective_actions (status, due_date);

-- Append-only timeline of comments / status changes.
create table public.corrective_action_updates (
  id                    uuid primary key default gen_random_uuid(),
  corrective_action_id  uuid not null references public.corrective_actions (id) on delete cascade,
  author_id             uuid not null references public.profiles (id) on delete restrict default auth.uid(),
  from_status           public.corrective_action_status,
  to_status             public.corrective_action_status,
  note                  text,
  created_at            timestamptz not null default now()
);
create index corrective_action_updates_action_idx
  on public.corrective_action_updates (corrective_action_id, created_at);

-- -----------------------------------------------------------------------------
-- pm_photos: evidence photos for PM items, failures and corrective actions.
-- Storage path convention: <site_id>/<visit_id|'ca'>/<photo_id>.jpg
-- -----------------------------------------------------------------------------
create table public.pm_photos (
  id                    uuid primary key default gen_random_uuid(),
  site_id               uuid not null references public.sites (id) on delete restrict,
  visit_id              uuid references public.pm_visits (id) on delete cascade,
  section_id            uuid references public.pm_sections (id) on delete restrict,
  checklist_item_id     uuid references public.pm_checklist_items (id) on delete restrict,
  reading_field_id      uuid references public.pm_reading_fields (id) on delete restrict,
  failure_id            uuid references public.failures (id) on delete set null,
  corrective_action_id  uuid references public.corrective_actions (id) on delete cascade,
  bucket                text not null default 'pm-photos',
  file_path             text not null,
  thumbnail_path        text,
  mime_type             text,
  size_bytes            integer check (size_bytes is null or size_bytes >= 0),
  width                 integer,
  height                integer,
  caption               text,
  latitude              double precision check (latitude between -90 and 90),
  longitude             double precision check (longitude between -180 and 180),
  taken_at              timestamptz not null,
  uploaded_at           timestamptz,
  uploaded_by           uuid not null references public.profiles (id) on delete restrict default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  updated_by            uuid references public.profiles (id) on delete set null,
  unique (bucket, file_path),
  constraint pm_photos_has_context check (
    visit_id is not null or failure_id is not null or corrective_action_id is not null
  )
);
create index pm_photos_visit_idx on public.pm_photos (visit_id);
create index pm_photos_item_idx on public.pm_photos (visit_id, checklist_item_id);
create index pm_photos_failure_idx on public.pm_photos (failure_id);
create index pm_photos_action_idx on public.pm_photos (corrective_action_id);

alter table public.dc_phase_currents
  add constraint dc_phase_currents_photo_fkey foreign key (photo_id) references public.pm_photos (id) on delete set null;

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  type          public.notification_type not null,
  title         text not null,
  body          text,
  entity_type   text,
  entity_id     uuid,
  read_at       timestamptz,
  push_sent_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;

-- -----------------------------------------------------------------------------
-- audit_logs (append-only; written only by SECURITY DEFINER functions/triggers)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  entity_type  text,
  entity_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

-- -----------------------------------------------------------------------------
-- site_documents
-- -----------------------------------------------------------------------------
create table public.site_documents (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites (id) on delete cascade,
  title         text not null,
  document_type text,
  bucket        text not null default 'site-documents',
  file_path     text not null,
  mime_type     text,
  size_bytes    integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null,
  updated_by    uuid references public.profiles (id) on delete set null,
  unique (bucket, file_path)
);
create index site_documents_site_idx on public.site_documents (site_id);

-- -----------------------------------------------------------------------------
-- equipment / equipment_history
-- -----------------------------------------------------------------------------
create table public.equipment (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites (id) on delete restrict,
  category        public.pm_category not null,
  equipment_type  text not null,
  manufacturer    text,
  model           text,
  serial_number   text,
  capacity        numeric,
  capacity_unit   text,
  installed_on    date,
  status          text not null default 'IN_SERVICE',
  notes           text,
  metadata        jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null,
  updated_by      uuid references public.profiles (id) on delete set null
);
create index equipment_site_idx on public.equipment (site_id, category);

create table public.equipment_history (
  id                    uuid primary key default gen_random_uuid(),
  equipment_id          uuid not null references public.equipment (id) on delete cascade,
  event_type            text not null,
  event_at              timestamptz not null default now(),
  visit_id              uuid references public.pm_visits (id) on delete set null,
  corrective_action_id  uuid references public.corrective_actions (id) on delete set null,
  notes                 text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  updated_by            uuid references public.profiles (id) on delete set null
);
create index equipment_history_equipment_idx on public.equipment_history (equipment_id, event_at desc);

select private.attach_audit_trigger('public.failures');
select private.attach_audit_trigger('public.corrective_actions');
select private.attach_audit_trigger('public.pm_photos');
select private.attach_audit_trigger('public.site_documents');
select private.attach_audit_trigger('public.equipment');
select private.attach_audit_trigger('public.equipment_history');

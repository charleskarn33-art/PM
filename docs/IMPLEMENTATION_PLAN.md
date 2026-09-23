# IPT PowerTech PM System — Technical Implementation Plan

Status: **Phases 1–4 complete** (see [Phase status](#phase-status)). Later phases are planned below and are not yet implemented.

## 1. Goals

Replace the manual, PDF-based preventive maintenance (PM) workflow for telecom site power with:

- a **technician mobile app** (Expo / React Native) that works **offline-first**,
- a **web portal** (Next.js) for supervisors, managers, administrators and viewers,
- a **Supabase backend** (PostgreSQL + Auth + Storage) where **Row Level Security (RLS) is the security boundary**.

The **Tienii (1301) Preventative Maintenance Report, 2026-09-15** is the reference for PM terminology and checklist structure: six sections (Generator, DC System, Battery, Solar, Non-Technical Observations, Earthing / Grounding), readings, YES/NO/N/A items, photos, comments, GPS, failure count and completion.

## 2. Repository layout

```
apps/
  web/                 Next.js 16 (App Router, Tailwind v4, shadcn/ui-style components)
  mobile/              Expo SDK 57 (Expo Router, SecureStore, SQLite)
packages/
  shared/              @ipt/shared — generated DB types + shared domain logic (roles, status tones, DC kW, ...)
supabase/
  migrations/          Ordered SQL migrations (schema, RLS, storage, reference template)
  seed.sql             DEMO data for local development only (is_demo = true)
  tests/               @ipt/db-tests — migration + RLS + workflow tests on real PostgreSQL
scripts/
  gen-db-types.mjs     Generates packages/shared/src/database.types.ts from the migrated schema
docs/
```

pnpm workspaces (hoisted linker for Metro compatibility). React is pinned to 19.2.3 across the repo (the version Expo SDK 57 requires; Next 16 supports it).

## 3. Architecture

```
 Mobile (Expo)  ── supabase-js (publishable key, user JWT) ──┐
   SQLite (offline store, Phase 5)                           │      Supabase
   SecureStore (session key)                                 ├──▶  PostgREST ──▶ PostgreSQL (RLS + triggers)
 Web (Next.js on Vercel)                                     │      Auth (GoTrue)
   Server Components / Server Actions (user JWT via cookies) ┘      Storage (private buckets, RLS on objects)
```

- **Clients only ever hold the publishable (anon) key** plus the user's JWT. Both apps refuse to start with a secret/service-role key (`readPublicEnv`, `readMobileEnv`).
- **Authorization lives in the database**: RLS policies decide *who* can touch a row; `BEFORE` guard triggers decide *what* they may change (workflow transitions, immutable fields). UI capability checks (`can(role, capability)`) only shape the interface.
- Business rules that must not be spoofed are evaluated server-side: failure detection (`pm_responses.is_failure`), prompt snapshots, visit reviewer, timestamps, audit entries.

## 4. Data model

All tables have UUID primary keys (client-generatable for offline records), `created_at/updated_at` and, where mutable, `created_by/updated_by` maintained by trigger (`private.set_audit_columns`).

| Area | Tables |
|---|---|
| Identity | `profiles` (1:1 `auth.users`), `roles`, `user_region_scopes`, `technicians`, `supervisors` |
| Organisation | `regions` → `clusters` → `counties` → `sites`; `site_assignments` |
| PM template (data-driven) | `pm_templates` (versioned) → `pm_sections` → `pm_reading_fields`, `pm_checklist_items` |
| PM execution | `pm_schedules`, `pm_visits`, `pm_responses`, `pm_readings`, `pm_photos` |
| Section analytics | `generator_readings`, `dc_readings` (+ generated `dc_power_kw`), `dc_phase_currents`, `battery_readings`, `solar_readings`, `earthing_readings` |
| Issues | `failures`, `corrective_actions`, `corrective_action_updates` |
| Support | `notifications`, `audit_logs`, `site_documents`, `equipment`, `equipment_history`, `system_settings` |

Key design decisions:

- **Checklist is data, not code.** Each `pm_checklist_items` row carries `response_type` (YES_NO_NA, NUMBER, TEXT, SELECT, MULTI_SELECT, PHOTO, DATE, DATETIME), `is_required`, `allow_not_applicable`, `unit`, `min_value/max_value`, `creates_failure_on_no/yes`, `failure_severity`, `requires_photo_on_failure`, `requires_comment_on_failure`, conditional evidence (`requires_photo_on_answer`, `requires_comment_on_answer`, `photo_instructions`), `metadata` (e.g. `{"phase_number": 3}`) and `analytics_key`.
- **History is never destroyed.** Items/sections/fields are deactivated (`is_active`, `deactivated_at`), FKs are `on delete restrict`, and every response stores `prompt_snapshot`/`unit_snapshot`. Templates are versioned (`code` + `version`, one ACTIVE per code).
- **Measurements are never overwritten.** Raw values live in `pm_readings`/`pm_responses`; calculated values are separate columns (`dc_readings.dc_power_kw` is a stored generated column = V × A / 1000).
- **Clamp-meter phases** are `NUMBER` items (unit `A`, `metadata.phase_number` 1–7) projected into `dc_phase_currents (phase_number, amp_value, unit, photo_id, comment)`.
- **Site hierarchy consistency**: `sites.region_id/cluster_id` are derived from `county_id` by trigger.
- **Duplicate-safe failures**: unique `(visit_id, checklist_item_id)` for checklist failures; repeated syncs cannot create duplicates.
- **No invented engineering limits.** Only definitional bounds are seeded (percent 0–100, counts ≥ 0). DC high-load thresholds live in `system_settings.dc_thresholds` and are `null` (disabled) until an administrator sets them.
- **Demo data is flagged** (`sites.is_demo`, `pm_visits.is_demo`) and shown with a banner/badge.

### Reference template (migration `…0800_reference_pm_template.sql`)

6 sections, 16 reading fields, 69 checklist items, text taken verbatim from the reference report. Failure rules are seeded from question polarity (e.g. *"Is The Machine burning Oil?"* YES → failure, *"Is Automation Working?"* NO → failure). Task/inspection confirmations (e.g. *"Fuel Filter Change"*) do not create failures. All seeded severities are MEDIUM. **These rules and severities must be confirmed by IPT PowerTech** and can be changed by a Super Admin without a code change.

## 5. Security model (RLS)

| Role | Read | Write |
|---|---|---|
| Super Admin | everything | everything (role changes only via `admin_update_user` RPC, audited) |
| Viewer | everything except audit log (read-only) | own contact details |
| Regional Manager | sites/people/PM/failures/actions in `user_region_scopes` regions | own contact details |
| Regional Supervisor | as manager | assignments, schedules, PM review (approve/reject), failures, corrective actions — in scope |
| Technician | actively assigned sites, own schedules/visits/responses/photos, own failures/actions | create/update own visits until submitted (or after rejection); manual failures and on-site corrective actions on assigned sites |
| Maintenance | assigned corrective actions and their sites | progress assigned actions up to COMPLETED |
| Inactive / new user | nothing | nothing |

Mechanics:

- Helpers are `SECURITY DEFINER` functions in schema `private` (not exposed by the Data API): `current_app_role`, `has_any_role`, `scoped_region_ids`, `scoped_site_ids`, `technician_site_ids`, `accessible_site_ids`, `can_manage_site`, `can_read_visit`, `can_edit_visit`, …
- Policies wrap helpers in `(select …)` so they are evaluated once per statement (scales to thousands of sites).
- `anon` has **no** privileges on any public table. Column-level grants restrict `profiles` (self-edit of name/phone/avatar only) and `notifications` (`read_at` only). Analytics tables and `audit_logs` are system-written only.
- Guard triggers: `guard_pm_visit` (technicians cannot approve, change site/technician/reviewer, or edit after submission; supervisors may only change review fields; rejection requires a reason), `guard_corrective_action` (OPEN → ASSIGNED → IN_PROGRESS → COMPLETED → VERIFIED → CLOSED; assignees cannot verify/close or reassign; completion requires a resolution; every transition is written to `corrective_action_updates`).
- Storage: private buckets `pm-photos` and `site-documents`, object path starts with `<site_id>/`; object policies follow site access. Photo evidence can only be deleted by a Super Admin.
- New sign-ups get an **inactive** profile; public sign-up is disabled in `supabase/config.toml`; the first admin is bootstrapped with `private.bootstrap_super_admin(email)` from the SQL editor.

## 6. Offline-first architecture (implemented in Phase 5)

The phone's SQLite database holds the technician's work; Supabase is the system of record. Code: `apps/mobile/src/offline/`.

**Download** — one RPC, `mobile_sync_bundle()` (security invoker, so RLS decides the scope): the technician's sites (from `site_overview`), open schedules, the templates they need (sections, questions, readings), their open visits with answers, readings and photo records, the settings the phone uses (`geofence`, `pm_submission`, `dc_thresholds`) and the active consistency rules.

**Local store** (`store.ts`, schema in `db.ts`, versioned with `pragma user_version`):

| Table | Holds |
|---|---|
| `documents` | Downloaded sites, schedules, templates, settings, rules, owner and last-sync time |
| `visits`, `responses`, `readings` | The technician's PM work |
| `photos` | Photo metadata plus the file and thumbnail on the phone |
| `outbox` | Changes to send: `key` (e.g. `response:<visit>:<item>`), kind, payload, state `PENDING / SYNCING / ERROR`, `version`, attempts, last error, next attempt |

A row has unsent changes exactly when an outbox operation with its key exists — there is no separate flag that could disagree. Editing the same thing again **coalesces** into the same operation (payload replaced or merged, `version` bumped). Submitting is queued as a new operation *after* everything already queued, so the server always sees the complete checklist before checking it.

**Send** (`sync.ts`): operations go in the order they were made. Each is marked `SYNCING`, sent, and removed only if its `version` did not change meanwhile (an edit made during sending is sent next, never lost). Every call is idempotent (device-generated ids, upserts, "already exists" treated as done, a resent submit accepted if the PM is already submitted).
- *Network problem* (no connection, timeout, 5xx, 429, expired session): the run stops and the operation waits 5 s, 10 s, 20 s … up to 10 min.
- *Server refusal* (RLS, validation, GPS block, incomplete checklist): the operation is kept as `ERROR` with the server's message and is not retried automatically; that visit's later changes wait behind it, other visits continue. The technician can **Retry**, **Withdraw submission and keep editing**, or **Discard unsent changes** (confirmed) on the Sync status screen.

**Download after send**: server data replaces the local copy except anything with an unsent change. Visits that left the technician's list (approved, reassigned) are removed with their photo files, unless they have unsent work.

**When it syncs**: after sign-in, when the app returns to the foreground, when the network comes back (`expo-network`, skipping the back-off), 3 s after edits, every 5 minutes, and on pull-to-refresh / **Sync now**.

**Accounts**: the local copy belongs to one user. Another account on the same phone never sends the first account's unsent work; signing out clears the phone's copy unless work is unsent (the technician is warned before signing out). The profile is cached encrypted so the app opens offline.

**Photos**: camera → resized to at most 1600 px (JPEG 0.7) plus a 320 px thumbnail → kept in the app's document folder → queued. Upload: file, thumbnail, then the `pm_photos` row (the database refuses the row until the file exists in storage). Path: `pm-photos/<site>/<visit>/<photo>.jpg`.

**GPS** at PM start: position (fresh fix with a 20 s limit, else a fix under 2 minutes old) compared with the site's coordinates and radius (site override or the default) using the configured mode. **WARN** records it, **REQUIRE_REASON** asks for a reason, **BLOCK** stops the start. The server repeats the calculation on arrival (`check_visit_gps`) and its values are the ones stored; a site without coordinates is never blocked. GPS evidence cannot be changed after the start (only a Super Admin can correct it).

**Session**: the Supabase session is persisted with AES-256-GCM (key in SecureStore, ciphertext in SQLite kv-store), so a technician stays signed in without connectivity.

## 7. Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, Supabase schema + migrations, roles, RLS, storage policies, auth (web + mobile), basic web dashboard, basic mobile app, tests, CI | **Done** |
| 2 | Admin UI: regions, clusters, counties, sites, users (invite, role, scope), technicians, supervisors, assignments | **Done** |
| 3 | PM scheduling, PM template management UI, PM visit engine (completion %, failure count, submission rules), PM review | **Done** |
| 4 | Section modules (Generator, DC, Battery, Solar, Non-Technical, Earthing) incl. analytics projections and DC phase currents; Tienii demo visit + readings | **Done** (except the Tienii demo visit — needs the report values) |
| 5 | Photos, GPS/geofence, offline SQLite store, outbox sync, Settings | **Done** |
| 6 | Failure creation on submission, corrective action workflow UI, notifications (in-app + push) | **Done** (push needs deployment setup) |
| 7 | Dashboards/analytics (region/county/technician/supervisor, DC load, battery, generator) | **Done** |
| 8 | PDF reports, CSV/Excel export, audit log UI | **Done** |
| 9 | Test expansion (E2E), security audit, performance, device testing | **Done** (device run pending hardware — see DEVICE_TESTING.md) |
| 10 | Production deployment (Supabase, Vercel, EAS) | Planned |

## Phase status

### Phase 1 — delivered

- Database: 8 migrations — foundation/enums, identity & organisation, PM templates & visits, failures/actions/support, security helpers & guards, RLS policies, storage, reference template. `seed.sql` holds demo data only.
- Security: RLS on every table (asserted by test), no `anon` grants, guard triggers, audited admin role changes, login auditing (`record_login` RPC).
- Types: `packages/shared/src/database.types.ts` generated from the migrated schema; CI fails if it drifts.
- Web: login (server action, error states), session refresh in `proxy.ts`, inactive-account page, role-aware sidebar (future modules shown disabled with their phase), breadcrumbs, dashboard KPIs from live RLS-scoped counts, profile page (edit name/phone), loading/error states, security headers.
- Mobile: login, encrypted session persistence, role gate (Technician/Maintenance), bottom tabs Home / Sites / PM / Actions / Profile with live data, pull-to-refresh, empty/error states, configuration error screen.
- Tests: 55 DB tests (schema, template, RLS per role, storage, workflow guards), 35 unit tests (shared, web, mobile), Android bundle export check.

### Phase 2 — delivered

- Database (migration `…0900_organization_management.sql`): active-technician check on site assignments (assignments ending in the past deactivate automatically), active-supervisor check on sites/technicians, audited `admin_set_region_scopes` and `record_report_generated` RPCs, audit triggers on regions/clusters/counties/technicians/supervisors, and `security_invoker` views `site_overview`, `technician_overview`, `supervisor_overview` (names, last/next PM, open failures/actions — always within the caller's RLS scope).
- Web:
  - **Sites**: search (site ID, name, county, cluster, region, technician, supervisor), filters (region, cluster, county, supervisor, PM status, site status), sortable columns, pagination (25/50/100), column visibility (kept in the URL), Excel-compatible CSV export of the current filter (audited as `REPORT_GENERATED`).
  - **Site detail**: overview, location (map link, geofence radius incl. system default), power configuration, assigned technicians (assign / end assignment, inactive accounts flagged), upcoming PM, PM history, open failures, corrective actions. Create/edit site with cascading Region → Cluster → County.
  - **Technicians** and **Supervisors** lists; **Admin → Organization** (regions/clusters/counties: create, edit, activate/deactivate); **Admin → Users** (search/filter, role/activation/home region, region scope, technician supervisor & employee code, supervisor employee code, invitations).
  - Auth email flows: `/auth/confirm` (token-hash verification), set password, forgot password.
- Mobile: site detail screen (location with native maps link, power configuration, next/last PM, open issues).
- Tests (at Phase 2): 78 DB/API tests (incl. 12 API integration tests through real PostgREST), 20 web, 20 shared, 13 mobile unit tests. End-to-end browser checks of all admin forms were run manually against PostgREST.

### Phase 3 — delivered

- Database (migration `…1000_pm_engine.sql`):
  - Write-time validation of answers and readings: configured min/max, whole numbers, allowed options, value type (a numeric question cannot take YES/NO).
  - **Server-computed** `completion_pct` (required items + required readings in sections not marked N/A) and `failure_count`; clients cannot write them.
  - Section N/A only where the section allows it.
  - **Submission rules**: required answers, comment on failure / on configured answers (e.g. battery water top-up = YES), photo on failure / on configured answers (e.g. fire extinguisher = YES). Error text: "Unable to submit because N required fields are incomplete."; `pm_visit_issues(visit_id)` lists them. Photo enforcement is a system setting (`pm_submission.enforce_photo_requirements`, default on) because photo capture ships in Phase 5.
  - Visit ↔ schedule linkage (same site/technician, one live visit per schedule) and automatic schedule status (IN_PROGRESS → SUBMITTED → APPROVED/REJECTED; cancelled visit reopens the schedule, OVERDUE if past due).
  - Schedules only for active technicians assigned to the site and the ACTIVE template; `mark_overdue_schedules()` (scheduled daily via pg_cron where available).
  - **Template versioning**: `admin_clone_template` (new DRAFT version), `admin_activate_template` (retires the previous version, moves open schedules; visits keep their version). Retired versions are read-only; drafts cannot be used for PM.
  - Views `pm_schedule_overview`, `pm_visit_overview` (RLS via security_invoker).
- Shared: TypeScript mirror of the checklist rules (`visitProgress`, `visitIssues`, `numberError`), recurrence dates (month-end safe), template/schedule validation. A database test proves the shared rules produce exactly the database's completion %, failure count and issue list.
- Web: **PM Schedule** (list with status/overdue/region/date filters; create one-off or recurring schedules; reschedule, reassign, cancel), **PM Visits & Review** (review queue, full checklist view with readings, answers, failures, comments, evidence counts, outstanding issues; approve / reject with required reason), **PM Templates** (versions, clone/activate, sections, readings and questions with every rule configurable, reordering, deactivation).
- Mobile: PM tab (start from schedule with a device-generated visit id, continue, fix & resubmit), visit screen (progress bar, per-section progress, section N/A), section screen (large YES/NO/N/A buttons, numeric keypad with units and range checks, choice chips, text, dates, comments, failure and evidence notices, per-answer save status with retry), submit screen (issues by section, overall comments).

### Phase 4 — delivered

- Database (migration `…1100_section_modules.sql`):
  - **Analytics projection**: answers and readings are copied into `generator_readings`, `dc_readings` (with the generated `dc_power_kw`), `dc_phase_currents`, `battery_readings`, `solar_readings` and `earthing_readings`, matched by `analytics_key`. Sections marked N/A are removed from the analytics; clearing a phase current removes that phase. Measured values are never modified.
  - Progress and analytics refresh run **once per statement per visit** (statement-level triggers with transition tables), so a bulk sync of a whole checklist is one refresh, not one per answer.
  - **Default N/A from site equipment**: Generator, Battery and Solar start as N/A when the site does not have that equipment; the technician can switch a section back on.
  - **Consistency rules** (`pm_consistency_rules`, admin-editable data): DC modules operational ≤ installed, solar panels operational ≤ installed, damaged panels ≤ installed. Violations are `INCONSISTENT` submission issues. No engineering thresholds are seeded.
- Shared: consistency rules in the TypeScript engine (still parity-tested against the database).
- Web: section summaries on the PM review page (generator services performed; DC calculated kW, modules, phase-current table and total; battery, solar and earthing flags; consistency warnings), and a "Latest readings" card on the site page (submitted/approved PM only).
- Mobile: live DC kW (V × A ÷ 1000) and phase total while entering the DC section, solar panels operational/installed, and consistency warnings as soon as values contradict.

### Phase 5 — delivered

- Database (migration `…1200_gps_photos_offline.sql`):
  - **GPS check** at PM start (`check_visit_gps`): distance (haversine, `private.distance_m`), radius (site override or default), mode and status are computed by the server; WARN / REQUIRE_REASON / BLOCK enforced; sites without coordinates never blocked. GPS evidence locked after start (`protect_visit_gps`).
  - **Photo integrity**: a `pm_photos` row is refused until its file is in storage.
  - **Offline download** RPC `mobile_sync_bundle()`.
  - **Settings validation** in the database (geofence radius/mode, DC thresholds, photo enforcement, notification settings) and **consistency-rule checks** (both values must be recorded values on a template, different, with a message); view `pm_value_keys` lists the values rules can use.
- Mobile: offline store and sync engine (section 6), GPS check-in on **Start PM** (reason prompt for REQUIRE_REASON, clear message for BLOCK), camera capture with compression and thumbnails on every checklist item (remove before upload; uploaded photos are kept as evidence), per-answer status (Saved on phone / Sent / Refused by server), sync bar on the main screens, **Sync status** screen, Home / Sites / site detail / PM list / checklist all read from the phone, offline profile cache, sign-out warning with unsent work, GPS check-in shown on the visit, DC high-load flag.
- Web: **Admin → Settings** (GPS geofence radius and mode, photo enforcement, DC high-load thresholds, consistency rules add/edit/deactivate; all audited), PM review page shows the **GPS check-in** (position, accuracy, distance, radius, mode, technician's reason) and **photo thumbnails** per item/section via short-lived signed URLs (shows "Not available" if a file cannot be signed), and the **DC high-load** flag when thresholds are configured.
- Tests: store and sync engine on a real SQL engine (node:sqlite) with a simulated server — ordering, coalescing, edits during sending, back-off, refusals holding one visit only, withdraw/discard, download never overwriting unsent work, account switching; error classification; and an **end-to-end test** of the phone's real sync code through PostgREST (own fixtures, commits real rows then removes them) that completes a full PM offline, sends it and gets it accepted, including a photo.

### Phase 6 — delivered

- Database (migration `…1300_failures_actions_notifications.sql`):
  - **Failures from a submitted PM**: one per failing checklist answer (sections marked N/A excluded), with the section as category, the item's configured severity and the technician's answer and comment as description. A resubmission after rejection updates them instead of duplicating; a failure the technician fixed before anyone acted on it is removed. Manual failures can be reported by supervisors (web) and technicians on their sites.
  - **Failure status follows its corrective actions** (least advanced action wins: Assigned → In progress → Resolved → Verified → Closed). Supervisors can close a failure without further work only with a note and only when no action is open, and can reopen it. Source, site, visit and item of a failure cannot be changed.
  - **Corrective actions**: site, visit and category come from the failure; assignees must be active technicians, maintenance users or supervisors (`corrective_action_assignees(site)` lists the eligible people); a completed action can be **returned** to the assignee with a required note (`return_corrective_action`); every status change and note is on the timeline.
  - **Notifications** (`private.notify`, never to the person who caused them, never to inactive users, de-duplicated by key): PM submitted (supervisor), approved / returned (technician), PM scheduled and site assigned (technician), PM overdue (technician + supervisor), critical failure (site supervisor + regional managers), corrective action assigned / returned (assignee), completed (supervisor + assigner). Daily job `run_daily_notifications()` (pg_cron) sends PM-due reminders and overdue corrective-action alerts **only when configured** in `system_settings.notifications`.
  - **Push**: `push_tokens` (own rows only), `register_push_token` / `unregister_push_token`; the **`send-push` Edge Function** sends pending notifications through the Expo push service with the service role (server side) and removes tokens Expo reports as unregistered.
  - Views `failure_overview`, `corrective_action_overview` (with overdue flag); `can_manage_site(site)` for the UI; `mobile_sync_bundle()` now includes the user's corrective actions (timeline, photos) and recent notifications.
- Web: **Failures** (filters, detail with evidence photos, create corrective action with assignee/priority/due date, severity, close with note / reopen, report a manual failure), **Corrective Actions** (filters incl. overdue and "assigned to me"; detail with start/complete for the assignee, verify / return with note / close / edit / close-with-reason for supervisors, notes, timeline, photos), **notification bell** with unread count and a **Notifications** page (mark read / all read, links to the item), failures raised shown on the PM review page.
- Mobile: corrective actions in the offline copy (local schema v2): **Actions** tab and action screen (start work, notes, photos, complete with what was done), all queued and sent in order like PM work; **Notifications** screen with unread bell in the header (marking read works offline); push registration on sign-in with the status shown on Profile, tapping a push opens the related screen, and sign-out unregisters the phone.
- Tests: 14 DB tests for failures, workflow, notifications, push tokens and the bundle; API tests for the new screens' queries; offline store tests for actions and notifications (including a v1 → v2 local database upgrade); push message building; end-to-end phone sync of a corrective action through the real API (start, note, photo, completion, notification read, harmless resend after verification).

### Phase 7 — delivered

- Database (migration `…1400_analytics.sql`), all SECURITY INVOKER so every figure is limited to the caller's RLS scope:
  - `analytics_pm_compliance(from, to, group, region?)` — PMs **due** in the period grouped by region, county, technician, supervisor or month: due, completed (submitted or approved), completed on time (submitted by the due date), overdue.
  - `analytics_failures(from, to, group, region?)` — failures **detected** in the period by section, severity, month, checklist item or site: found, not yet verified, critical, average hours from detection to resolution (resolved ones only).
  - `analytics_technicians(from, to, region?)` — per active technician: PMs submitted / approved / returned / awaiting review, average PM duration, failures found, corrective actions assigned / completed / overdue.
  - `analytics_latest_readings(region?)` — latest recorded readings per site from **submitted or approved** PMs only: DC voltage, load current, calculated kW, modules, phase count / min / max / total; generator running hours, fuel, oil pressure, kVA, service needed; battery voltage, capacity, strings, damage, water top-up; solar panels; earthing abnormalities.
- Web: **Analytics** (Super Admin, Regional Manager, Regional Supervisor, Viewer) with one filter row (period presets — this month, last 3 / 12 months, year to date, custom range — and region) and four tabs:
  - *Overview*: KPI row (compliance, on time, overdue, failures, average time to resolve, critical), compliance by month (line), PMs due vs completed by month (columns), compliance by region, failures by section and by severity.
  - *Technicians & supervisors*: on-time completion by technician, technician performance table, compliance by supervisor and by county.
  - *Failures*: found vs not yet verified by month, most frequent failing items, sites with the most failures (linked).
  - *Equipment*: DC load by site with the configured high-load flag, phase imbalance (information only), generators, batteries, solar and earthing.
  - Every chart has a **table view** with the same numbers; charts use a validated colour order (checked for colour-vision deficiencies), status colours only for states (severity), hover tooltips, one axis per chart, and a linear line (no smoothing that would suggest values never recorded). Empty periods say so instead of drawing zero charts. The dashboard links to Analytics.
- Tests: analytics functions against the database (grouping, on-time/overdue logic, scope per role, submitted-only readings, anonymous denied), API tests of every loader and grouping, unit tests for the period presets, month buckets and phase imbalance; browser checks of all four tabs, tooltip, invalid custom range and phone width.

### Phase 8 — delivered

- **PM visit PDF report** (`/visits/<id>/report`, A4, server-rendered with `@react-pdf/renderer`): header with site, region, county, technician, supervisor, start/submission times, status, completion, failure count, template version and the GPS check-in (distance, radius, mode, reason when outside). Then, per section in template order: recorded readings, the calculated DC power and phase currents (with the configured high-load flag), every checklist answer with failing answers highlighted and comments shown, and the section's photos. Ends with failures raised, overall comments, the supervisor's review and signature lines. Page numbers and "generated at / by" on every page; demo sites carry a DEMO banner. Up to 24 photos are embedded (photos of failing items first; JPEG/PNG only — anything else prints "Photo not available"). Opened from the **PDF report** button on the visit page or from **Reports**; access follows RLS (anyone who can open the visit can print it) and each report generated is audited.
- **CSV exports** (UTF-8 with byte-order mark so Excel opens them directly; cells starting with `=`, `+`, `-` or `@` are prefixed so they never run as formulas; up to 10,000 rows, paged 1,000 at a time): PM visits, failures, corrective actions and sites — each list's **Export CSV** button exports exactly the filtered list — plus every Analytics table (compliance by region / county / technician / supervisor / month, technician performance, failures by section / severity / month / item / site, latest equipment readings). Every export is recorded in the audit log with its filters and row count.
- **Reports** page (Super Admin, Regional Manager, Regional Supervisor, Viewer): period / region / search filters, PM visit PDFs (up to 50 most recent submitted, approved or returned PMs), list CSVs and analytics CSVs.
- **Audit log** (migration `…1500_audit_log.sql`, Super Admin only): row changes now record *what* changed — new records' identifying fields, `{column: {from, to}}` for updates (updates that only touch timestamps are skipped), and a snapshot of deleted rows; long values are shortened in the log. The log is **append-only** for everyone including server code (a trigger rejects update/delete). `/admin/audit` lists entries with person, role, action, record (linked where it still exists) and readable details, filterable by text, action, record type and date, with CSV export.
- Fix across all paged lists: a page number past the end (an old link, or after filters shrink the list) now returns to page 1 instead of an error page, and exports whose size is an exact multiple of 1,000 rows no longer fail on the last page.
- Tests: audit detail, append-only and admin-only access against the database; API tests for the report data, exports and audit queries; unit tests for report formatting, audit summaries and paging; browser checks of the PDF (content and page layout), every export, the Reports and Audit pages, access per role (supervisor → 404 on audit, technician → own PDF only, bad / missing visit → 400 / 404) and phone width.

### Phase 9 — delivered

- **Browser tests** (`e2e/`, Playwright, 26 tests, run in CI): the production web build against a fresh database, the real PostgREST and a test gateway standing in for Supabase Auth/Storage. Covers sign-in (wrong password, return to the requested page, crafted return addresses, sign-out, deactivated accounts), every role's menu and the pages each role must not reach, PM review (return with a reason, approve the resubmission, other regions locked out, PDF download), failure → corrective action → maintenance completes → supervisor verifies (with the failure status following), a filtered CSV export, the Reports page, the audit log, adding a site, and that every page renders under the Content-Security-Policy without script errors.
- **Security review** (`docs/SECURITY.md`; migration `…1600_security_hardening.sql`). Fixed:
  - an open redirect after sign-in (`/\t/evil.example` became `//evil.example` in browsers);
  - photo evidence could be overwritten by its uploader after submission (storage upsert) — now locked once the photo is recorded; the phone checks before retrying;
  - app users held TRUNCATE (bypasses RLS and the audit log's append-only guard), REFERENCES and TRIGGER on every table, write grants on views and `setval` on the numbering sequences — revoked;
  - report audit entries could carry unbounded data — bounded;
  - auth email links fell back to the request's Host header when `SITE_URL` was unset — production now requires `SITE_URL`.
  Added a nonce-based Content-Security-Policy and HSTS. A catalog test suite (`security.test.ts`) fails if a later migration regresses any of these (definer functions without `search_path`, anon access, tables without policies, definer views, writable views, dangerous grants, an unreviewed public SECURITY DEFINER function).
- **Performance** (`supabase/tests/perf/`): a 1,200-site, two-year data set (26,000 PMs, 1.6 million answers, 290,000 audit entries) loaded through the real triggers, and a benchmark of every web loader, analytics function and the mobile sync download through PostgREST per role. Found and fixed (migration `…1800_rls_performance.sql`):
  - a supervisor's or manager's PM visit list took **16.6 s** — RLS policies ran a query per row for rows outside their region; now set-based: **46 ms** (same rules; photos 1.8 s → 66 ms);
  - technician performance **0.9 s → 31 ms** (grouped aggregates instead of per-technician sub-queries);
  - analytics results were silently cut at PostgREST's 1,000-row response limit (e.g. latest readings for 1,205 sites showed 1,000) — now paged.
  After the fixes every case is under 400 ms (median); slowest: latest readings for all 1,200 sites (0.39 s), mobile sync download (0.37 s), sites list filtered by overdue PM (0.33 s).
- Found by the browser tests: a supervisor could not see the name of the Maintenance user they had assigned work to (migration `…1700_profile_visibility.sql`); the audit log now shows status changes as `SUBMITTED → REJECTED` and "PM" labels correctly.
- **Device testing**: a step-by-step plan for real phones (`docs/DEVICE_TESTING.md`) — **not run** here (no device or emulator in this environment).

### Known limitations after Phase 9

- The mobile app has not been run on a physical device or emulator; camera, GPS, SecureStore, push delivery and app-lifecycle behaviour must be checked with `docs/DEVICE_TESTING.md` before release.
- Browser tests sign in through a test stand-in for Supabase Auth; the hosted Auth service (password rules, rate limits, emails) is exercised only in a real project.
- Two moderate advisories in Expo's dependency tree are accepted (see `docs/SECURITY.md`); re-check on each Expo SDK upgrade.
- Benchmarks are from a development container; production numbers depend on the Supabase plan. The performance run is manual (not in CI).

### Known limitations after Phase 8

- "Excel export" is CSV (opens directly in Excel); native `.xlsx` workbooks are not generated.
- Reports use the standard PDF fonts (Latin characters only): common symbols such as ≥, ≤ and smart quotes are converted, and any other character outside Latin-1 prints as "?". Embedding a Unicode font is a small change if needed.
- The PDF embeds at most 24 photos; all photos stay available on the visit page.
- Exports stop at 10,000 rows — narrow the filters for larger extracts.
- Audit entries recorded before this phase carry only the changed column names, not the before/after values.

### Known limitations after Phase 7

- "Returned" counts PMs that are **currently** sent back; a PM that was returned and later approved counts as approved (the full review history is in the audit log, which only Super Admins read).
- Analytics are web-only; the phone shows the technician's own work lists, not trend charts.
- Figures are computed on request from live tables; at much larger data volumes, materialised summaries may be needed (Phase 9 performance work).

### Known limitations after Phase 6

- **Push delivery is not verified here**: sending needs the Edge Function deployed with `PUSH_FUNCTION_SECRET`, a schedule or webhook to call it, and an EAS project id in the app build (see SETUP.md). The message building and token clean-up logic is unit-tested; the Deno function itself was not run in this environment.
- Notification settings (`pm_due_reminder_days`, `corrective_action_overdue_enabled`) are validated but still edited in SQL / the table editor; adding them to Admin → Settings is small and can be done with Phase 7/8 admin work.
- Technicians see their failures through their PMs and corrective actions; they do not have a separate Failures screen.

### Known limitations after Phase 5

- **Not run on a device in this environment**: the app bundles for Android and all sync logic is tested, but camera, GPS and background/foreground behaviour need a device or emulator run (Phase 9 device testing).
- **Storage** is simulated in the end-to-end test and browser checks (the Supabase Storage server cannot run here); upload and signed-URL calls use the standard supabase-js Storage API.
- Photos are uploaded as one request each (no resumable upload); a very slow connection retries the whole photo.
- ~~Corrective actions are still online-only~~ — offline since Phase 6.
- The `notifications` setting is validated but not editable in Settings yet: it has no effect until notifications ship in Phase 6.

### Known limitations after Phase 4

- **Tienii (1301) demo visit not seeded**: the reference report's recorded readings are needed; they were not provided with the PDF, so nothing is invented.
- "Voltage from each battery" remains a YES/NO/N/A question with the voltages in its comment, as in the reference checklist; a per-battery table can be added as template configuration later if IPT PowerTech wants it.
- ~~Consistency rules have no admin screen yet~~ — added in Phase 5 (Admin → Settings).

### Known limitations after Phase 3

- The mobile app still needs a connection: answers save immediately and failed saves are kept on screen with **Retry**, but they are not stored on the device across app restarts (Phase 5 SQLite outbox).
- Photo capture is Phase 5; with photo enforcement on, items that need a photo block submission until then (an administrator can switch enforcement off meanwhile).
- Failure records and corrective actions are not yet created from submitted PM (Phase 6); `failure_count` and the per-answer failure flag are already server-computed.
- The mobile screens were checked by type-checking, lint, unit tests, the Android bundle build and the API tests of the calls they make; they have not been run on a device or emulator in this environment.

### Known limitations after Phase 2

- Invitations require `SUPABASE_SECRET_KEY` on the web server and the Auth email templates described in `docs/SETUP.md`; the auth email round-trip itself has not been exercised against a live Supabase Auth server.
- Global search (sites, people, failures, corrective actions in one box) is planned with the Phase 6/7 screens that hold those records; the Sites list search covers site, county, technician and supervisor.
- Supervisor PM-completion/overdue/failure metrics arrive with analytics (Phase 7).

### Known limitations after Phase 1

- Checklist-driven failure *records* are not yet created automatically (the `is_failure` flag is computed server-side now; failure rows on submission arrive in Phase 6).
- `pm_visits.completion_pct` and `failure_count` are columns only; server-side calculation arrives in Phase 3.
- Analytics tables are defined but not yet populated (Phase 4).
- Mobile app is online-only; offline storage/sync is Phase 5.
- DB tests run on PostgreSQL 16 with a small Supabase shim (`supabase/tests/sql/00_supabase_shim.sql`). They have not yet been run against a full Supabase stack; do that with `supabase db reset` before production.
- The Tienii report PDF was not available in the repository, so the demo seed includes only region + site; the demo visit and readings are added in Phase 4 from the report.

# IPT PowerTech Telecom Power PM System — Implementation Plan

Architecture decision (2026-09-25): **NestJS REST API + MySQL 8 + Prisma**,
JWT access and refresh tokens, server-controlled file storage, Next.js web,
Expo mobile with an offline SQLite store. **No Supabase** (database, auth,
storage, functions or APIs). The previous Supabase implementation is archived
in [`legacy/`](legacy/README.md) and removed as each area is rebuilt.

## 1. Starting point (inspection, 2026-09-25)

| Item | Found |
|---|---|
| Repository | pnpm 10.33 monorepo, Node 22.22.2, TypeScript 5.9.3 |
| `apps/web` | Next.js 16.3.6, Tailwind v4, shadcn-style UI — every page reads data through Supabase |
| `apps/mobile` | Expo SDK 57 / React Native 0.86.3, Expo Router, SecureStore, SQLite offline store and sync engine on the API |
| `packages/shared` | Domain logic (DC kW, geofence, checklist rules, schedule recurrence, CSV) and zod validation — backend-neutral, reused |
| `supabase/` | PostgreSQL migrations, RLS, triggers, tests — **replaced** |
| MySQL | not installed; no `docker/`, no API application |
| Environment | `.env.example` files for Supabase keys only; no committed secrets |

**Reused:** web and mobile UI (screens, components, charts, PDF layout), the
mobile offline store / outbox / sync-engine design, shared domain logic and
validation, the reference PM template content, and the testing approach
(browser E2E, performance data set). **Replaced:** every data path
(Supabase client → typed REST client), auth, storage and the database layer.

## 2. Target architecture

```
 Next.js web ──HTTPS──┐                         ┌── Prisma ── MySQL 8 (private network only)
                      ├─► Nginx (TLS, Let's Encrypt) ─► NestJS API ─┤
 Expo app ──HTTPS─────┘      rate limits, headers       │          └── StorageService ── local disk │ S3-compatible
   └ SQLite + sync queue                                └── worker (notifications, reports, overdue jobs)
```

- The mobile app and the web browser **never** reach MySQL; only the API does.
- **Monorepo:** `apps/api`, `apps/web`, `apps/mobile`; `packages/shared`
  (domain logic), `packages/validation` and `packages/types` (API contracts
  shared by API, web and mobile — introduced with the first endpoints that
  need them, Phase 2–4), `prisma/` (schema, migrations, seed), `docker/`, `docs/`.

## 3. Key decisions

| Topic | Decision |
|---|---|
| IDs | UUID everywhere (`CHAR(36)`), v7 on the server (time-ordered, index-friendly); the phone generates UUIDs for offline records so retries are idempotent |
| API | REST under `/api/v1`, JSON; success `{ "data": …, "meta"?: … }`, error `{ "error": { "code", "message", "details"?, "requestId" } }`; cursor/offset pagination with a hard page-size cap |
| Validation | DTOs validated by zod schemas shared with web and mobile; unknown fields rejected; numbers never silently coerced |
| Auth | Argon2id password hashes; short-lived access JWT (`JWT_SECRET`); refresh JWT (`JWT_REFRESH_SECRET`) with a server-side record per token: rotation on every refresh, reuse detection revokes the family, logout revokes. Web keeps tokens in httpOnly cookies set by its server (never readable by page scripts); mobile in SecureStore |
| Authorisation | Global guard: every endpoint requires authentication unless marked public; explicit permissions per role (`roles`, `permissions`, `role_permissions`, `user_roles`); organisational scope (region / cluster / county / site assignment / ownership) enforced in services with shared scope helpers and tested per role |
| Checklist | Data-driven templates with immutable versions; visits pin the version they started on; failure rules and severities are data |
| Sync | `POST /sync` batches with client IDs + idempotency keys (`sync_records`); server returns per-item results; photos uploaded separately and linked by client ID; nothing deleted on the phone before server confirmation |
| Storage | `StorageService` interface (`upload`, `download`, `delete`, `getSignedUrl`); `LocalDiskStorage` first (HMAC-signed, expiring URLs served by the API), S3-compatible adapter later; business logic stores only storage keys |
| Audit | Append-only `audit_logs` written in the same transaction as the change |
| Logging | pino JSON logs with request ID, user ID, method, route, status, duration; passwords, tokens and cookies redacted |
| Deployment | Docker Compose on a VPS: nginx, api, mysql (no public port), worker; web on Vercel or the same VPS; Let's Encrypt; scheduled MySQL backups with retention, restore verification and an off-server copy |

## 4. Phases

Each phase ends with: typecheck, lint, tests, build, database and API checks,
a written report, and **approval before the next phase**.

| # | Phase | Main deliverables |
|---|---|---|
| 1 | Foundation | `apps/api` (NestJS): typed env validation, structured logging with request IDs, Helmet, CORS, rate limiting, validation, response/error envelope, health + readiness (MySQL); Prisma 7 + MySQL 8 configured; auth foundation (Argon2 hashing, JWT config, deny-by-default guard, `@Public()`); Docker Compose (nginx, api, mysql), Dockerfile, nginx TLS config; `.env.example`; CI job with MySQL |
| 2 | Database | Prisma schema for users, roles, permissions, organisation (regions → clusters → counties → sites), site assignments with history; migrations; seed (roles/permissions, reference template; Tienii **demo** data kept separate) |
| 3 | Auth & authorisation | Login, refresh (rotation, reuse detection), logout/revocation, `/auth/me`; permission and scope guards; user & role admin endpoints; web login via the API (httpOnly cookies); mobile login (SecureStore) |
| 4 | PM engine | Templates, versions, sections, checklist items (all response types), reading fields, failure rules; schedules (frequency, priority, statuses); visits, responses, readings, completion % |
| 5 | Power modules | Generator, DC (phases 1–7 as amp readings, kW calculated and stored separately), battery (per-battery readings where configured), solar (N/A for sites without solar), non-technical, earthing; configurable validation ranges only |
| 6 | Mobile | Home, My Sites, schedule, site details, start PM with GPS & geofence (WARN / REQUIRE_REASON / BLOCK, default WARN), section screens, camera, signature, review & submit |
| 7 | Offline | SQLite store on the new API, sync queue with statuses (LOCAL, PENDING_SYNC, SYNCING, SYNCED, SYNC_ERROR), exponential back-off, conflict handling, offline photos |
| 8 | Failures | Failure engine (idempotent), corrective-action workflow (assign → work → complete → verify → close), comments, photos, documents |
| 9 | Web dashboard | KPI dashboard, sites, technicians, supervisors, failures, corrective actions, global search — web fully on the API; Supabase code removed from web |
| 10 | Analytics | PM completion (region, county, technician), DC load, battery, generator; configurable thresholds |
| 11 | Reports | PDF PM report (structure of the source report, photos, signatures), CSV exports with filters, PM history |
| 12 | Notifications | In-app + push (worker), all listed triggers |
| 13 | Audit | Complete audit coverage and the audit UI |
| 14 | Testing | Unit, integration, authorisation matrix, sync, the 20-step end-to-end scenario, performance data set |
| 15 | Production deployment | VPS hardening, TLS, backups and restore drill, monitoring, release process; remaining Supabase code deleted |

## 5. Delivered so far

**Phase 1 — Foundation.** See the table above; verified against MySQL 8.0 locally and in CI (MySQL 8.4).

**Phase 2 — Database.**
- Tables: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`,
  `user_region_scopes`, `regions`, `clusters`, `counties`, `sites`,
  `site_assignments` (migration `20260926101054_organisation_and_access`).
- Database-level rules beyond Prisma: CHECK constraints (lower-case e-mail,
  coordinate ranges and pairs, assignment dates) and triggers that keep a
  site's region / cluster / county consistent, including when a cluster or
  county is moved.
- Permission catalogue (27 permissions) and the six system roles, seeded
  idempotently (`pnpm db:seed`); the demo seed (`pnpm db:seed:demo`) holds only
  Tienii 1301 / Grand Cape Mount / Abraham Cole, flagged `is_demo`.
- Services (no HTTP routes yet): organisation hierarchy and sites, users with
  roles and region scopes, site assignments with history (one active
  supervisor per site, several technicians, ended rather than deleted).
- A site's supervisor is its active SUPERVISOR assignment, not a column on
  `sites`, so the history stays complete.
- PM templates, visits and readings are Phase 4–5 tables; the demo PM visit
  (100 % complete, readings) is seeded with them.

**Phase 3 — Authentication and authorisation.** (Endpoints: [`API.md`](API.md).)
- Sign-in with Argon2id, the same answer for unknown e-mail and wrong
  password, account lockout after repeated failures, per-IP rate limit on the
  auth endpoints (the web server relays the browser's IP with a shared
  secret, `WEB_FORWARD_SECRET`).
- Refresh tokens stored server-side (`refresh_tokens`), rotated on every use,
  reuse detection revoking the session family (short grace period for
  parallel requests), sign-out, sign-out everywhere, and immediate invalidation
  of access tokens on sign-out everywhere, password change and deactivation.
- Temporary passwords set by an administrator must be changed at the next
  sign-in; the first Super Admin is created with `pnpm db:create-admin`.
- A global guard that loads roles, permissions and scope from the database on
  every request and refuses any route without an access declaration; scope
  filters for sites, regions and people; HTTP routes for users, roles,
  organisation, sites and assignments.
- Web: sign-in, sign-out, password change and the profile page on the API
  (tokens in httpOnly cookies, refreshed by the proxy). Mobile: sign-in,
  password change and profile on the API (tokens in SecureStore, offline-safe
  refresh). Their other screens still read the archived Supabase backend until
  Phases 4–9; the Supabase-based browser suite is retired and rebuilt in Phase 14.
- Not yet: audit log entries for sign-ins and changes (Phase 13), e-mail
  password reset (no e-mail service configured), scheduled purge of expired
  refresh-token rows (`AuthService.purgeExpired`, run by the worker in Phase 12).

**Phase 4 — PM engine.**
- Tables: `pm_templates` (versions), `pm_sections`, `pm_checklist_items`,
  `pm_reading_fields`, `pm_consistency_rules`, `pm_schedules`, `pm_visits`,
  `pm_responses`, `pm_readings`, `pm_photos` (migration `pm_engine`), with
  triggers: one active version per template, structure editable only in drafts.
- Reference template version 1 (the Tienii report's six sections, 69
  questions, 16 readings, 3 consistency rules) seeded as configuration; Oil
  Pressure is a text reading because the report records it as "Okay".
- Engine (pure functions, unit-tested): answer and reading validation for every
  question type, failure rules, required comment / photo evidence, consistency
  rules, completion % and failure count.
- Template versioning (draft → active → retired), schedules with recurrence,
  overdue marking in the organisation's time zone, visits (start, answers,
  complete, approve / return), photos through the storage abstraction
  (`StorageService`, local disk).
- Demo: the Tienii PM visit (completed, 2026-09-15) with the report's readings.
  **Its checklist answers are not in the information provided, so none are
  seeded, and its completion % is computed from the recorded data (19.04 %),
  not copied from the report.**
- Not yet: GPS / geofence and signature at the visit (Phase 6), failure
  records and corrective actions (Phase 8), power-module analytics tables
  (Phase 5), signed photo URLs.

**Phase 5 — Power modules.**
- Tables `generator_readings`, `dc_readings`, `dc_phase_currents`,
  `battery_readings`, `battery_unit_readings`, `solar_readings`,
  `non_technical_observations`, `earthing_readings` (migration
  `power_modules`); `sites.battery_unit_count`.
- One record per visit and section, rebuilt from the visit's answers and
  readings whenever they change (through the template's analytics keys);
  none for a section marked not applicable (solar at sites without solar).
- DC: phases 1–7 stored as the recorded amp values; DC kW (V × A / 1000) and
  total phase current calculated with exact decimals into their own columns.
- Battery: each battery's voltage at sites with a configured battery count —
  required before completion — with the min / max per visit.
- Validation ranges come only from the template (administrator-configured);
  none are added by the modules.
- Reference template seed: DC phases keyed per phase and non-technical
  questions keyed (the seed of an already-seeded database is not changed;
  local databases seeded during Phase 4 need their PM data re-seeded).
- Site power history endpoint per module.
- Charts and analytics thresholds came with Phase 10.

**Phase 6 — Mobile.**
- API: `system_settings` (geofence WARN / REQUIRE_REASON / BLOCK with a
  radius, default WARN 100 m; signature required, default on),
  `sites.geofence_radius_m`, visit GPS and geofence result, technician
  signature drawn by the server from the phone's strokes (cleared by any later
  change, required before completion unless switched off).
- Mobile app on the API: Home (counts and PMs to continue), My Sites (search),
  PM Schedule (to do / done), site details (equipment, maps, recent visits,
  unscheduled PM), Start PM (GPS fix, geofence check with the configured mode,
  reason when required), visit overview (progress, sections, N/A switches,
  comments), section screens for every answer type and readings, evidence
  camera (compressed, uploaded), per-battery voltages, review with signature
  and completion. Edits show at once and are saved in batches; the server's
  progress and issues are shown after each save.
- The Supabase-based mobile code (offline store, sync, push, notifications,
  corrective-action screens) is removed; Phase 7 rebuilds offline work on the
  API, Phase 8 corrective actions, Phase 12 notifications.
- Phase 6 needed a connection to load and save; Phase 7 below makes the
  field work offline. It has not been run on a device in this environment: it typechecks,
  lints, passes its unit tests and bundles for Android, and the request
  shapes it sends were run against the real API.

**Phase 7 — Offline.**
- API: `GET /field/pack` — the technician's sites, open PM schedules, active
  checklist versions, consistency rules, settings and open visits in full, for
  the phone to keep. The visit detail carries `engine` (rules, battery
  requirement, signature setting) so the phone judges a visit by itself.
- One PM engine, two identical copies: `apps/api/src/pm/engine.ts` and
  `packages/shared/src/pm/engine.ts` (the phone's); an API test fails when
  they differ.
- Phone store (expo-sqlite, per signed-in user): saved copies of the lists
  and the field pack, each visit's last server copy, and the outbox of
  changes not yet accepted (start, answers and readings, battery voltages,
  photos, photo removal, signature, completion). What is shown is the server
  copy with the queued changes applied, judged on the phone (completion %,
  failures, what blocks completion).
- Sync statuses: visit `LOCAL` (only on the phone), `PENDING_SYNC`,
  `SYNCING`, `SYNCED`, `SYNC_ERROR`; each change `PENDING_SYNC`, `SYNCING` or
  `SYNC_ERROR` (removed once accepted).
- Sync engine: one visit's changes strictly in order; bursts of edits joined
  into one request; no connection or a server problem (5xx, 408, 429) →
  retried with exponential back-off (5 s doubling to 15 min, ±20 % jitter);
  any other refusal → `SYNC_ERROR`, shown on the visit with **Try again** or
  **Discard** (discarding a refused start removes that visit from the phone).
  Runs on start, when the connection returns, when the app comes to the
  front, after edits, and when a postponed change is due.
- Conflicts: every change is safe to send twice (client ids for visits and
  photos, `clientUpdatedAt` per answer, reading and battery). When the server
  keeps a newer value from another device it says so and the phone shows a
  notice. A completion whose answer was lost is recognised as done.
- Offline start: the phone applies the same checks as the server with the
  pack's data (assignment, active site, geofence mode and radius, reason,
  equipment sections not applicable); the server checks again when the start
  arrives.
- Offline photos: kept in the app's folder until uploaded, then removed; a
  photo removed before it was sent is simply dropped.
- Screens: sync bar (Home, PM Schedule, Profile), sync state per visit and
  per PM, "saved on phone" in the section header, saved copies shown with
  their date when offline, a warning before signing out with unsent changes
  (they stay on the phone for that account).
- Verified: unit tests of the store and sync engine on SQLite (Node's
  built-in), and a run of the phone's store and sync engine against the real
  API over HTTP: a whole PM done with the connection cut, then sent — the
  server's copy matched the phone's (COMPLETED, 100 %). Not yet run on a
  device (see Remaining work in the phase report).

**Phase 8 — Failures.**
- Tables `failures`, `corrective_actions`, `failure_updates` (timeline:
  comments, status changes, recorded edits) and `failure_attachments`
  (migration `failures_corrective_actions`); numbers FL-000001 / CA-000001.
- Failure engine: completing a PM records a failure for each failed answer in
  an applicable section, with the item's severity. Idempotent — one failure
  per visit and question (unique index); completing again after a return
  updates it, deletes it if no longer reported and nobody acted on it, or
  marks it no longer reported.
- Failures reported by hand at a site (technicians at their sites,
  supervisors in their regions), with a client id so a retry does not
  duplicate.
- Corrective-action workflow: create (optionally assigned) → assign → start
  → complete (with what was done) → verify (approve, or send back with a
  note) → close; withdraw an action not started (with a note). The assignee
  must hold `corrective_actions.work` and work at the site; the person who did
  the work cannot verify it. The failure's status follows its actions; it
  can be closed by hand (no open action) and reopened.
- Comments, photos (JPEG / PNG / WebP) and PDF documents on failures and
  actions, checked by content, stored through the storage service; documents
  are served as downloads. New setting `DOCUMENT_MAX_BYTES` (default 20 MB).
- Mobile: Actions tab (assigned to me: to do, awaiting check, closed), action
  detail with the failure, timeline and files; start, notes, photos and
  completion; "Report a failure" from a site. Maintenance users see Home and
  Actions only. These screens need a connection to change anything (viewing
  uses the saved copy).
- Web screens for failures and corrective actions come with the web
  dashboard (Phase 9); notifications (assignment, overdue) with Phase 12.

**Phase 9 — Web dashboard.**
- API: `GET /dashboard` (KPI summary), `GET /people` (technicians' and
  supervisors' workload), `GET /search` (sites, failures, corrective actions,
  people); the site list and detail carry an overview (technicians,
  supervisor, last and next PM, open failures and actions) with filters by
  supervisor, technician and PM state, and sorting.
- Web fully on the API: dashboard; sites (list with filters and column
  choice, detail with people and assignments, create and edit); technicians;
  supervisors; PM schedule (list, plan a PM or a recurring series, change,
  cancel); PM visits (list, detail with every answer, reading, photo, the
  signature and the GPS result; approve or return); failures (list, detail
  with timeline, photos and PDFs, comments, edit, close and reopen, report on
  site); corrective actions (list, detail with every workflow step for the
  person who may take it); administration (users with roles, regions,
  activation, temporary passwords and unlock; organisation; PM templates with
  versions, sections, questions, readings and consistency rules; settings);
  global search in the header.
- Navigation follows the API permissions. Analytics (done in Phase 10), Reports
  (done in Phase 11), Notifications (Phase 12) and the Audit log (Phase 13) are shown
  as not yet available instead of pages on the old backend.
- Photos, signatures and attachments reach the browser through the web server
  (`/files/…`, allow-listed paths only, the user's own session); the browser
  never calls the API or holds its tokens. The Content-Security-Policy allows
  this site only.
- Supabase removed from the web: its client, data layer, pages, dependencies
  (`@supabase/*`, and `@react-pdf/renderer` / `recharts` until Reports and
  Analytics return) and environment variables. The web health check now
  checks the API. The Supabase-era browser suite (`e2e/`) and the PostgREST
  tests of the old web data layer were removed with it; an end-to-end suite
  on the API comes with Phase 14. The archived Supabase database tests
  (`supabase/tests`) remain as reference.
- Verified: integration tests of the new endpoints, and a browser run
  (Playwright, production build, real API on MySQL) as administrator,
  supervisor, technician and maintenance user — dashboard figures, site
  filters, creating a site, a user, a PM series and a failure, approving a
  PM, a corrective action from creation to closure with a PDF, and the file
  relay refusing what a user may not see (37 checks, no console or server
  errors).

**Phase 10 — Analytics.**
- API: `GET /analytics/completion` (PM completion by region, county or
  technician, with a monthly trend: due, completed, on time, late, overdue,
  open, rates), `GET /analytics/power` (DC load, batteries, generators: each
  site's latest reading and monthly averages), `GET /analytics/failures`
  (detected and closed per month, by severity and PM section, top sites and
  checklist questions, time to close). Scoped like everything else; months
  in the organisation's time zone; 6 months by default, 24 at most.
- Only finished work counts: readings come from completed or approved PM
  visits (a PM in progress or returned for correction is left out).
- New setting `thresholds` (DC load maximum, rectifier, battery bank and
  single-battery voltage minimums, fuel minimum, generator service hours,
  PM completion target). Every one starts empty; nothing is flagged or
  marked "below target" until an administrator sets it.
- Web: Analytics page (PM completion, power systems, failures) with a month
  range, region and grouping filters; line charts with a legend for two or
  more series, a crosshair tooltip on hover or arrow keys, the configured
  target or limit as a dashed line, and a table view; ranked bars; latest
  reading per site with its flags. Thresholds form in Settings. The dashboard
  links to Analytics.
- Figures are computed in the API from the rows in the period (loaded and
  grouped in memory); fine for the expected size (thousands of sites × 24
  months), to revisit with SQL aggregation if it grows far beyond that.
- Verified: unit tests of the rules (month ranges in the time zone, rates,
  flags only with thresholds), integration tests of the endpoints (counts,
  scope, target, flags, readings of unfinished PMs excluded, range
  validation), and a browser run (production build, real API on MySQL; 25
  checks: figures, hover tooltip, table view, grouping, thresholds saved and
  cleared, flags, supervisor scope, technician refused, no horizontal scroll
  on a phone).

**Phase 11 — Reports.**
- PM visit report as a PDF, generated by the API (pdfkit) from the stored
  visit, so the web and later the phone get the same document: header (site,
  region and county, technician, checklist version, dates, due date, status,
  completion, GPS result), each section with its readings, calculated
  figures (DC power, total phase current, lowest / highest battery and each
  battery's voltage), checklist answers with failures highlighted and the
  photos taken for them, other photos, failures raised, comments, review,
  and the technician's signature drawn from the stored strokes; page numbers
  and "DEMO DATA" on demo records. Photos are converted to JPEG and reduced
  (sharp) so WebP prints and the file stays small; a photo that cannot be
  read is left out (logged), never failing the report. The standard PDF
  fonts print Western European text; other characters print as "?".
- CSV exports of PM visits (with key readings), schedules, failures,
  corrective actions, sites and power readings, with the list's own filters
  (the site export reuses the site list's filter code), streamed with no row
  limit, Excel-friendly and formula-safe.
- Site PM history: every PM visit at a site with its result and readings.
- Web: Reports page (PM reports with PDF links, PM history site search,
  export forms), "Export CSV" on the visits, schedule, failures, corrective
  actions and sites lists, "PM report (PDF)" on a visit, PM history page
  from a site. The web server relays PDFs and CSVs with the user's session
  (empty form fields are dropped; long exports are allowed 10 minutes).
- New setting `ORG_NAME` (printed on reports; default "IPT PowerTech").
- Not in this phase: the phone does not download reports yet; generating a
  report is not recorded in an audit log (Phase 13).
- Verified: unit tests (PDF content, page breaks, photos, signature, text
  the fonts cannot print; CSV quoting and formula safety; batched reading),
  integration tests (PDF within scope, WebP converted, unreadable photo left
  out; every export with filters, scope and validation; PM history), and a
  browser run (production build, real API on MySQL; 23 checks: PDF through
  the web server, list exports following their filters, Reports page forms,
  PM history, supervisor scope, technician refused exports but able to read
  their own report, no horizontal scroll on a phone). The PDF was also
  rendered to images and inspected page by page.

## 6. Open decisions (do not block Phase 1)

1. Web hosting: Vercel or the VPS (both kept possible).
2. VPS provider, OS and domain names (API and web).
3. Push notifications through Expo's push service (a third-party service) — acceptable?
4. Keep the Supabase code in the repository as reference until each area is replaced (current plan), or delete it now.

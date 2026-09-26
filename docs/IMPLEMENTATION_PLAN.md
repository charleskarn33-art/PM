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
| `apps/mobile` | Expo SDK 57 / React Native 0.86.3, Expo Router, SecureStore, SQLite offline store and sync engine — talks to Supabase |
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

## 6. Open decisions (do not block Phase 1)

1. Web hosting: Vercel or the VPS (both kept possible).
2. VPS provider, OS and domain names (API and web).
3. Push notifications through Expo's push service (a third-party service) — acceptable?
4. Keep the Supabase code in the repository as reference until each area is replaced (current plan), or delete it now.

# API reference (v1)

Base URL `https://<api-domain>/api/v1`. JSON in and out.

- Success: `{ "data": …, "meta"?: { "total", "page", "pageSize" } }`
- Error: `{ "error": { "code", "message", "details"?, "requestId" } }` — `code`
  is stable (e.g. `INVALID_CREDENTIALS`, `FORBIDDEN`, `NOT_FOUND`,
  `VALIDATION_FAILED`); `message` is written for users.
- Unknown fields are rejected (422). Ids are UUIDs; an unknown or malformed id,
  or a record outside the caller's scope, answers 404.
- Lists: `?page=1&pageSize=25` (at most 100).

## Access rules

Every route declares one of: public, any signed-in user, or a set of
permissions (all required). A route without a declaration is refused — this is
checked by a test over every route.

The user's roles, permissions and region scope are read from the database on
every request, so changes apply immediately. **Scope:** Super Admins see
everything; everyone else sees the sites in the regions of their scope plus
the sites they are actively assigned to, and the people who belong to or work
in those regions. Organisation, site and user changes are made by users with
access everywhere.

## Sessions

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/auth/login` | public, rate-limited | `{ email, password, client: "web" \| "mobile" }` → tokens + user. Wrong e-mail and wrong password give the same answer; repeated failures lock the account for a while |
| POST | `/auth/refresh` | public, rate-limited | `{ refreshToken }` → new pair. Each refresh token works once (a reuse within `AUTH_REFRESH_REUSE_GRACE_SECONDS` is tolerated for parallel requests); a later reuse ends the whole session |
| POST | `/auth/logout` | public | `{ refreshToken }` → 204; ends that session |
| POST | `/auth/logout-all` | signed in | 204; ends every session, including access tokens already issued |
| GET | `/auth/me` | signed in | roles, permissions, region scope, `mustChangePassword` |
| POST | `/auth/change-password` | signed in, rate-limited | `{ currentPassword, newPassword, client }` → new pair; other sessions end |

Access tokens last `JWT_ACCESS_TTL` (15 min), refresh tokens `JWT_REFRESH_TTL`
(30 days). While a temporary password must be replaced, only `/auth/*` and
`GET /me/profile` answer (others: 403 `PASSWORD_CHANGE_REQUIRED`).

## Own profile

| Method | Path | Access |
|---|---|---|
| GET | `/me/profile` | signed in |
| PATCH | `/me/profile` | signed in — `{ fullName?, phone? }` only |
| GET | `/me/assignments` | `sites.read` — the caller's active site assignments |

## Users and roles

| Method | Path | Permission |
|---|---|---|
| GET | `/users?q&role&regionId&active` | `users.read` (scoped) |
| GET | `/users/:id` | `users.read` (scoped) |
| GET | `/users/:id/access` | `users.read` + `roles.read` |
| POST | `/users` | `users.manage` |
| PATCH | `/users/:id` | `users.manage` |
| PUT | `/users/:id/roles` | `users.manage` — the last active Super Admin keeps the role |
| PUT | `/users/:id/region-scopes` | `users.manage` |
| POST | `/users/:id/activate`, `/users/:id/deactivate` | `users.manage` — deactivation ends sessions and site assignments |
| POST | `/users/:id/temporary-password` | `users.manage` — `{ temporaryPassword }`; user must change it |
| POST | `/users/:id/unlock` | `users.manage` — clears a sign-in lockout |
| GET | `/roles`, `/roles/permissions` | `roles.read` |

## Organisation and sites

| Method | Path | Permission |
|---|---|---|
| GET | `/org/hierarchy` | `org.read` (scoped) — regions → clusters → counties |
| POST / PATCH | `/regions`, `/regions/:id` | `org.manage` |
| POST / PATCH | `/clusters`, `/clusters/:id` | `org.manage` |
| POST / PATCH | `/counties`, `/counties/:id` | `org.manage` |
| GET | `/sites?q&regionId&clusterId&countyId&status` | `sites.read` (scoped) |
| GET | `/sites/:id` | `sites.read` (scoped) |
| POST / PATCH | `/sites`, `/sites/:id` | `sites.manage` — includes `batteryUnitCount` (batteries in the bank; each PM then records every battery) |

## Site assignments

| Method | Path | Permission |
|---|---|---|
| GET | `/sites/:id/assignments` | `assignments.read` (scoped) — history, newest first |
| POST | `/assignments` | `assignments.manage` — `{ siteId, userId, role, startDate }`; supervisors only on sites in their regions and only technicians |
| POST | `/assignments/:id/end` | `assignments.manage` — `{ endDate, reason? }` |

## PM templates

A template has versions. A version's structure (sections, questions,
readings, failure rules) is edited only while it is a **DRAFT** — also
enforced by the database. Activating a draft retires the previous version and
moves open schedules to it; visits keep the version they started on.

| Method | Path | Permission |
|---|---|---|
| GET | `/pm-templates`, `/pm-templates/:id` | `pm_templates.read` — `:id` returns sections → questions and readings |
| POST | `/pm-templates` | `pm_templates.manage` — `{ code, name, description? }` → draft version 1 |
| PATCH / DELETE | `/pm-templates/:id` | `pm_templates.manage` — drafts only |
| POST | `/pm-templates/:id/new-version` | `pm_templates.manage` — draft copy (one draft per template) |
| POST | `/pm-templates/:id/activate` | `pm_templates.manage` |
| POST | `/pm-templates/:id/sections`; PATCH / DELETE `/pm-sections/:id` | `pm_templates.manage` |
| POST | `/pm-sections/:id/items`; PATCH / DELETE `/pm-items/:id` | `pm_templates.manage` |
| POST | `/pm-sections/:id/reading-fields`; PATCH / DELETE `/pm-reading-fields/:id` | `pm_templates.manage` |
| GET / POST | `/pm-consistency-rules`; PATCH `/pm-consistency-rules/:id` | read: `pm_templates.read`; change: `pm_templates.manage` |

Question types: `YES_NO_NA`, `NUMBER`, `TEXT`, `SELECT`, `MULTI_SELECT`,
`DATE`, `DATETIME`, `PHOTO`. Failure rule: `failureOnAnswer` (YES or NO) with
`failureSeverity`, and optional comment / photo evidence on failure or on
given answers. Minimum, maximum and whole-number rules apply only where set.

## PM schedules

| Method | Path | Permission |
|---|---|---|
| GET | `/pm-schedules?siteId&technicianId&status&mine&from&to` | `pm_schedules.read` (scoped) |
| GET | `/pm-schedules/:id` | `pm_schedules.read` (scoped) |
| POST | `/pm-schedules` | `pm_schedules.manage` — `{ siteId, technicianId?, templateCode?, frequency, scheduledDate, dueDate, occurrences?, priority?, notes? }`; the technician must be assigned to the site; recurring plans create one schedule per occurrence |
| PATCH | `/pm-schedules/:id` | `pm_schedules.manage` — while scheduled / overdue |
| POST | `/pm-schedules/:id/cancel` | `pm_schedules.manage` — `{ reason }` |

Statuses: SCHEDULED, IN_PROGRESS, COMPLETED, APPROVED, REJECTED, OVERDUE,
CANCELLED. Scheduled PMs past their due date (in `ORG_TIMEZONE`) become
OVERDUE at start-up and hourly.

## PM visits

| Method | Path | Permission |
|---|---|---|
| POST | `/visits` | `pm_visits.perform` — `{ id?, scheduleId }` or `{ id?, siteId, templateCode? }`, plus `gps?: { latitude, longitude, accuracyM?, capturedAt? }` and `outsideRadiusReason?`; only a technician assigned to the site; retrying with the same `id` returns the same visit. The geofence (below) is checked against the position sent |
| GET | `/visits?siteId&technicianId&status&mine&from&to`, `/visits/:id` | `pm_visits.read` (scoped) — the detail includes the template structure, answers, readings, photos, progress and open issues |
| PUT | `/visits/:id/answers` | `pm_visits.perform`, own visit — `{ responses?, readings?, notApplicableSections?, overallComments? }`; all or nothing; an answer without values clears it; an edit with an older `clientUpdatedAt` than the stored one is skipped |
| POST | `/visits/:id/complete` | `pm_visits.perform`, own visit — 422 `VISIT_INCOMPLETE` lists every missing answer, reading, comment, photo or inconsistency |
| POST | `/visits/:id/review` | `pm_visits.review` — `{ decision: APPROVE \| REJECT, comments? }` (comments required to reject); not one's own visit |
| POST | `/visits/:id/photos` | `pm_visits.perform`, own visit — multipart: `file` (JPEG / PNG / WebP by content, at most `PHOTO_MAX_BYTES`), `id?`, `checklistItemId?`, `caption?`, `takenAt?` |
| GET | `/visits/:id/photos/:photoId` | `pm_visits.read` (scoped) — the image |
| DELETE | `/visits/:id/photos/:photoId` | `pm_visits.perform`, own editable visit |
| PUT | `/visits/:id/signature` | `pm_visits.perform`, own editable visit — `{ name?, width, height, strokes: [[x, y], …][] }`; the server draws the signature (SVG); any later change to the visit clears it |
| GET | `/visits/:id/signature` | `pm_visits.read` (scoped) — the image (`image/svg+xml`) |
| PUT | `/visits/:id/battery-units` | `pm_visits.perform`, own visit — `{ units: [{ unitNumber, voltageV \| null, comment?, clientUpdatedAt? }] }`; only at sites with `batteryUnitCount`; every battery is then required before completion |

The visit detail includes `modules` — the power-module records built from its
answers and readings (null for a section not applicable): `generator`, `dc`
(with `phases`, calculated `dcPowerKw` and `totalPhaseCurrentA`), `battery`
(with `units` and their min / max), `solar`, `nonTechnical`, `earthing`.

It also includes `engine` — what the phone needs to judge the visit offline
with the same rules: `{ rules, batteryUnits: { count, sectionCode } | null,
requireSignature }`. `PUT /visits/:id/answers` returns `skipped` (edits older
than the stored ones) and `PUT /visits/:id/battery-units` `skippedBatteryUnits`.

Visit flow: IN_PROGRESS → COMPLETED → APPROVED, or REJECTED → (technician
edits) IN_PROGRESS → COMPLETED. Completion % counts required answers and
readings in applicable sections (rounded down, so 100 % means complete).

### PM start geofence

Setting `geofence` (`mode`, `radiusM`; default WARN, 100 m); a site's
`geofenceRadiusM` overrides the radius. **WARN** records the position and
distance; **REQUIRE_REASON** needs `outsideRadiusReason` outside the radius or
without a position (422 `REASON_REQUIRED`); **BLOCK** refuses (422
`OUTSIDE_GEOFENCE`). A site without coordinates is never blocked. The position
is what the phone reports; it is stored with the result (`gpsStatus`,
`gpsDistanceM`, `gpsRadiusM`, `geofenceMode`).

## Field pack (offline data for the phone)

| Method | Path | Permission |
|---|---|---|
| GET | `/field/pack` | `pm_visits.perform` — `{ generatedAt, userId, settings, sites, schedules, templates, rules, visits, moreVisitIds }`: the sites the technician is assigned to, their open PM schedules, the active template versions with their structure, active consistency rules, settings, and the technician's open visits in full (first 50; the ids of any others) |

The phone keeps this so PM work continues without a connection, and sends its
changes later through the endpoints above (see the offline notes in
`IMPLEMENTATION_PLAN.md`).

## Settings

| Method | Path | Permission |
|---|---|---|
| GET | `/settings` | signed in — `{ geofence: { mode, radiusM }, pm: { requireSignature } }` |
| PUT | `/settings/:key` | `settings.manage` — `geofence` or `pm` |

## Site power history

| Method | Path | Permission |
|---|---|---|
| GET | `/sites/:id/power/:module?from&to&status&limit` | `pm_visits.read` (scoped) — `module`: `generator`, `dc`, `battery`, `solar`, `non-technical`, `earthing`; one record per PM visit, newest first, at most 200 |

Measured values are as recorded. Calculated values have their own fields:
`dcPowerKw` = rectifier voltage × load current / 1000 (exact decimals, 6
places), `totalPhaseCurrentA` = sum of the recorded clamp-meter phases.

## Health

`GET /health` (liveness) and `GET /health/ready` (MySQL reachable) are public.

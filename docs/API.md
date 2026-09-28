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
| GET | `/sites?q&regionId&clusterId&countyId&status&supervisorId&technicianId&pm&sort&dir` | `sites.read` (scoped) — `q` matches site ID, name or county; `pm` = `overdue` / `scheduled` / `none`; `sort` = `siteCode` / `siteName` / `region` / `status` |
| GET | `/sites/:id` | `sites.read` (scoped) |

Each site in the list and the detail carries `overview`: active technicians
and supervisor, `lastPmAt` (last completed PM), `nextPm` (earliest open
schedule: due date and status), `openFailures` and `openActions`.
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

## Failures

| Method | Path | Permission |
|---|---|---|
| GET | `/failures?siteId&visitId&status&severity&source&q&from&to` | `failures.read` (scoped: sites in scope, plus failures with an action assigned to the caller) — `status=active` for everything not closed; `q` searches the title or the number (`FL-000012`) |
| GET | `/failures/:id` | `failures.read` (scoped) — with its actions, timeline (`updates`) and attachments |
| POST | `/failures` | `failures.report` — `{ id?, siteId, title, description?, severity?, category? }`, at a site the caller is assigned to or supervises; retrying with the same `id` returns the same failure |
| PATCH | `/failures/:id` | `failures.manage`, site in the caller's regions — `{ title?, description?, severity? }` (recorded on the timeline) |
| POST | `/failures/:id/close` | `failures.manage` — `{ note }`; 409 `ACTIONS_OPEN` while an action is open, assigned, in progress or completed |
| POST | `/failures/:id/reopen` | `failures.manage` — `{ note }`; earlier closed actions no longer count |
| POST | `/failures/:id/comments` | `failures.read` and one of `failures.report`, `failures.manage`, `corrective_actions.manage`, or assignee of an action — `{ body, correctiveActionId? }` |
| POST | `/failures/:id/attachments` | as comments — multipart: `file` (JPEG / PNG / WebP photo up to `PHOTO_MAX_BYTES`, or PDF up to `DOCUMENT_MAX_BYTES`, checked by content), `id?`, `correctiveActionId?`, `caption?`; not on a closed failure |
| GET | `/failures/:id/attachments/:attachmentId` | `failures.read` (scoped) — photos inline, documents as downloads |
| DELETE | `/failures/:id/attachments/:attachmentId` | the uploader, or a supervisor of the site's region |

**Failure engine.** Completing a PM turns each failed answer (the item's
failure rule) in an applicable section into a failure (`source`
`PM_CHECKLIST`, the item's `failureSeverity`, numbered `FL-000001`…). One
failure per visit and question: completing the PM again (after it was
returned) updates it; a failure no longer reported is deleted if nobody acted
on it, otherwise marked `stillReported: false`.

**Status.** A failure's status follows its corrective actions (the least
advanced one decides): OPEN (none, or none assigned) → ASSIGNED → IN_PROGRESS
→ RESOLVED (completed) → VERIFIED → CLOSED (all closed). Withdrawn actions do
not count. It can also be closed by hand with a note, and reopened.

## Corrective actions

| Method | Path | Permission |
|---|---|---|
| GET | `/corrective-actions?status&assignedTo&siteId&failureId&overdue` | `corrective_actions.read` (scoped: sites in scope, plus actions assigned to the caller) — `assignedTo=me`, `status=active` (open to completed), `overdue=true` (active and past the due date, in `ORG_TIMEZONE`) |
| GET | `/corrective-actions/:id` | `corrective_actions.read` (scoped) — with the failure, its timeline entries and attachments |
| POST | `/corrective-actions` | `corrective_actions.manage`, site in the caller's regions — `{ id?, failureId, title, description?, priority?, assignedToId?, dueDate? }`; not on a closed failure |
| PATCH | `/corrective-actions/:id` | `corrective_actions.manage` — `{ title?, description?, priority?, dueDate? }` |
| POST | `/corrective-actions/:id/assign` | `corrective_actions.manage` — `{ assignedToId, dueDate? }`; the assignee must be active, hold `corrective_actions.work` and work at the site (assigned to it or in its region) |
| POST | `/corrective-actions/:id/start` | `corrective_actions.work`, the assignee — ASSIGNED → IN_PROGRESS |
| POST | `/corrective-actions/:id/complete` | `corrective_actions.work`, the assignee — `{ note }` (what was done) → COMPLETED |
| POST | `/corrective-actions/:id/verify` | `corrective_actions.manage`, not the person who did the work — `{ decision: APPROVE \| REJECT, note? }` (note required to send it back) → VERIFIED or IN_PROGRESS |
| POST | `/corrective-actions/:id/close` | `corrective_actions.manage` — `{ note? }`; closes a verified action, or withdraws one not started (note required) |
| POST | `/corrective-actions/:id/comments`, `/corrective-actions/:id/attachments` | as for failures, marked with the action |

A step not possible from the current status is refused with 409
`INVALID_TRANSITION`. Every step, comment and change is kept on the failure's
timeline with who and when.

## Dashboard, people and search

| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard` | `analytics.read` (scoped) — sites (total, active, demo); PM due and completed this month (organisation time zone) with the completion rate (completed ÷ due, null when nothing is due), overdue, in progress, waiting for review, returned; open failures by severity and by PM section, new in 30 days; corrective actions active, overdue, waiting for verification; the latest completed PMs and open failures |
| GET | `/people?role=TECHNICIAN\|REGIONAL_SUPERVISOR&q&regionId` | `users.read` (scoped) — technicians with assigned sites, open and overdue PMs, PMs completed in 30 days, last PM, open and overdue corrective actions; supervisors with supervised sites, sites in their regions, PMs waiting for review, open failures and actions waiting for verification |
| GET | `/search?q=` | signed in — up to 5 each of sites, failures (title or `FL-…`), corrective actions (title or `CA-…`) and people (with `users.read`), within the caller's scope and permissions |

Every figure is counted from the records in the database; nothing is estimated.

## Analytics

All `analytics.read`, scoped to the caller's sites. `from` / `to` are months
(`YYYY-MM`, organisation time zone); without them the last 6 months up to the
current one; at most 24 months (otherwise 422). `regionId` and `countyId`
narrow the sites.

| Method | Path | Result |
|---|---|---|
| GET | `/analytics/completion?from&to&by=region\|county\|technician&regionId&countyId` | PM schedules **due** in the months (not cancelled): `due`, `completed` (completed or approved), `onTime` (its finished visit completed on or before the due date), `late`, `overdue` (not completed, past due), `open`, `ratePct`, `onTimePct`, `belowTarget` (null without a configured target) — in `total`, per group (`technician` = the technician the PM was assigned to) and per month due (`trend`) |
| GET | `/analytics/power?from&to&regionId&countyId&siteId` | `dc`, `battery`, `generator`: readings of **completed or approved** PM visits only — `readings`, `sitesReported`, `sitesFlagged`, `overall` figures, each site's latest reading with `flags`, and a monthly `trend` (averages; null when nothing was recorded) |
| GET | `/analytics/failures?from&to&regionId&countyId` | `detected` and `closed` in the months with a monthly `trend`, `openNow`, detected `bySeverity` and `byCategory`, the 10 `topSites` and `topItems` (checklist questions), and `timeToClose` (days from detection to closing, mean and median, of failures closed in the months) |

Flags (`DC_LOAD_HIGH`, `RECTIFIER_VOLTAGE_LOW`, `BATTERY_VOLTAGE_LOW`,
`BATTERY_UNIT_LOW`, `FUEL_LOW`, `SERVICE_HOURS_REACHED`) are raised only
against configured thresholds; a missing reading is never flagged.

## Reports

| Method | Path | Permission |
|---|---|---|
| GET | `/visits/:id/report.pdf` | `pm_visits.read` (scoped) — the PM visit report (A4 PDF, `inline`): site and visit, GPS result, each section's readings, calculated figures (DC power, total phase current, battery units), checklist answers with failures marked, photos (JPEG / PNG / WebP, reduced for print), failures raised, comments, review and the technician's signature; "DEMO DATA" on demo records |
| GET | `/sites/:id/pm-history?from&to&page&pageSize` | `pm_visits.read` (scoped) — the site's PM visits, newest first: status, due date and on time, checklist completion, failures, reviewer, key readings (DC load, rectifier, battery bank and lowest battery, fuel, running hours); `meta` has the site and a count per status |
| GET | `/exports/<dataset>.csv?filters` | `reports.export` (scoped) — see below |

Exports are CSV (UTF-8 with a byte-order mark, RFC 4180 quoting, text that
starts with `=`, `+`, `-` or `@` prefixed with `'` so spreadsheets never run
it), streamed in batches with no row limit, as `attachment`. Dates and times
are in the organisation's time zone. `from` / `to` are `YYYY-MM-DD`.

| Dataset | Filters (as the matching list) | Date filter on |
|---|---|---|
| `visits` (with key readings; also the PM history of a site) | `status`, `siteId`, `technicianId`, `regionId`, `from`, `to` | start |
| `schedules` | `status`, `siteId`, `technicianId`, `regionId`, `from`, `to` | scheduled date |
| `failures` | `status` (or `active`), `severity`, `category`, `source`, `siteId`, `visitId`, `regionId`, `q`, `from`, `to` | detection |
| `corrective-actions` | `status` (or `active`), `assignedToId`, `assignedTo=me`, `overdue=true`, `siteId`, `regionId`, `from`, `to` | creation |
| `sites` | the site list's filters (`q`, `regionId`, `clusterId`, `countyId`, `status`, `supervisorId`, `technicianId`, `pm`) | — |
| `readings` | `module=dc\|battery\|generator` (required), `siteId`, `regionId`, `from`, `to`; completed or approved PMs only | recording |

The visit list (`GET /visits`) also accepts `status=finished` (completed or
approved).

## Notifications

| Method | Path | Permission |
|---|---|---|
| GET | `/notifications?unread=true&page&pageSize` | signed in — the caller's own, newest first: `{ id, type, title, body, entityType, entityId, readAt, createdAt }`; `meta.unread` |
| GET | `/notifications/unread-count` | signed in — `{ unread }` |
| POST | `/notifications/:id/read` | signed in (own only; others' are 404) — `{ unread }` |
| POST | `/notifications/read-all` | signed in — `{ marked, unread: 0 }` |
| POST | `/push-tokens` | signed in — `{ token (Expo push token), platform: android\|ios, deviceName? }`; a token already registered to someone else moves to the caller; `{ registered, pushEnabled }` |
| DELETE | `/push-tokens` | signed in — `{ token }`, the caller's own only (sign-out) |

When they are sent (never to the person who caused the event, never to
inactive users, at most once per event and person):

| Type | Recipients | When |
|---|---|---|
| `PM_SCHEDULED` | the technician | a PM (or a recurring series: one notification) is scheduled for them, or reassigned to them |
| `SITE_ASSIGNED` | the person assigned | assigned to a site as technician or supervisor |
| `PM_SUBMITTED` | the site's supervisors¹ | a technician completes a PM (each time, also after a correction) |
| `PM_APPROVED` / `PM_RETURNED` | the technician | a supervisor approves the PM / returns it (with the comments) |
| `PM_OVERDUE` | the technician and the site's supervisors | the hourly job marks a PM overdue |
| `FAILURE_CRITICAL` | the site's supervisors and the region's managers | a critical failure is recorded (checklist, reported on site, or raised to critical) |
| `ACTION_ASSIGNED` | the assignee | a corrective action is assigned (at creation or later) |
| `ACTION_COMPLETED` | whoever assigned it and the site's supervisors | the assignee completes it (to verify) |
| `ACTION_RETURNED` | the assignee | the supervisor sends the work back |
| `PM_DUE_SOON` | the technician | only when `settings.notifications.pmDueReminderDays` is set: once per PM coming within that many days of its due date |
| `ACTION_OVERDUE` | the assignee and the site's supervisors | only when `settings.notifications.actionOverdueAlerts` is on: once when an assigned action passes its due date |

¹ Supervisors assigned to the site and regional supervisors whose scope
includes its region.

**Push:** with `PUSH_ENABLED=true` each notification is also sent to the
recipient's registered phones through Expo's push service (by the API's
push sender every 15 seconds; batches of 100; retried up to 3 times when the
service cannot be reached; not sent when older than 24 hours; phones Expo
reports as no longer registered are removed). With push disabled (the
default) nothing is sent to Expo and notifications are in-app only.

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
| GET | `/settings` | signed in — `{ geofence: { mode, radiusM }, pm: { requireSignature }, thresholds: { … }, notifications: { pmDueReminderDays, actionOverdueAlerts } }` |
| PUT | `/settings/:key` | `settings.manage` — `geofence`, `pm`, `thresholds` or `notifications` |

`thresholds` (all numbers or `null`; every one is `null` until an
administrator sets it, and a `null` threshold flags nothing):
`dcLoadKwMax`, `rectifierVoltageMin`, `batteryVoltageMin`,
`batteryUnitVoltageMin`, `fuelLevelMinPct` (0–100), `generatorServiceHours`,
`completionTargetPct` (0–100). A PUT sends all seven.

## Site power history

| Method | Path | Permission |
|---|---|---|
| GET | `/sites/:id/power/:module?from&to&status&limit` | `pm_visits.read` (scoped) — `module`: `generator`, `dc`, `battery`, `solar`, `non-technical`, `earthing`; one record per PM visit, newest first, at most 200 |

Measured values are as recorded. Calculated values have their own fields:
`dcPowerKw` = rectifier voltage × load current / 1000 (exact decimals, 6
places), `totalPhaseCurrentA` = sum of the recorded clamp-meter phases.

## Health

`GET /health` (liveness) and `GET /health/ready` (MySQL reachable) are public.

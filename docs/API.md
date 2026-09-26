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
| POST / PATCH | `/sites`, `/sites/:id` | `sites.manage` |

## Site assignments

| Method | Path | Permission |
|---|---|---|
| GET | `/sites/:id/assignments` | `assignments.read` (scoped) — history, newest first |
| POST | `/assignments` | `assignments.manage` — `{ siteId, userId, role, startDate }`; supervisors only on sites in their regions and only technicians |
| POST | `/assignments/:id/end` | `assignments.manage` — `{ endDate, reason? }` |

## Health

`GET /health` (liveness) and `GET /health/ready` (MySQL reachable) are public.

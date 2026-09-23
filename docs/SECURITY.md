# Security review (Phase 9)

What was reviewed, what was found and fixed, and what remains an accepted
risk. Items marked **tested** are enforced by an automated test that fails if
a later change regresses them.

## Model

- **Authorisation lives in the database.** Every table has row-level security
  (RLS); the web and mobile apps use the publishable key and the signed-in
  user's session, so each query sees only what that user may see. The web
  app's role checks (menus, `requireRole`, `requireCapability`) are a second
  layer for pages and server actions, never the only one.
- **No service-role key in any client.** The only server-side secret is
  `SUPABASE_SECRET_KEY`, used by the web server for invitations; the build
  fails if a secret is exposed through a `NEXT_PUBLIC_` variable, and the
  mobile app has no secret at all.

## Checks and results

### Database

| Check | Result |
|---|---|
| RLS enabled on every table; every table has a policy | Pass — **tested** |
| `anon` has no table privileges and cannot execute any function or use the `private` schema | Pass — **tested** |
| Every `SECURITY DEFINER` function pins `search_path` | Pass — **tested** |
| Views run with the caller's permissions (`security_invoker`) and are read-only | Views: pass. Write grants on views existed (harmless: none is updatable) — **removed**, **tested** |
| Public `SECURITY DEFINER` functions authorise the caller | All 11 reviewed and pass — allow-list **tested** so a new one needs review |
| `authenticated` held TRUNCATE / REFERENCES / TRIGGER on every table (Supabase default grants) | **Fixed.** Not reachable through the API, but TRUNCATE bypasses RLS and row triggers (e.g. the audit log's append-only guard) — **tested** |
| Numbering sequences readable/resettable (`setval`) by users | **Fixed** (usage only) — **tested** |
| Report audit entries: any active user could write an unbounded filters object into the append-only log | **Fixed** (bounded like other audit values) — **tested** |
| Photo evidence: the uploader could overwrite a photo file (storage upsert) even after the PM was submitted | **Fixed**: a file can be re-uploaded only until its photo row is recorded; the phone checks for an existing row before retrying — **tested** |
| Audit log is append-only | Pass (Phase 8) — **tested** |

### Web

| Check | Result |
|---|---|
| Every server action checks the role/capability before acting | Pass (login, password reset and set-password are the intended exceptions) |
| Post-login redirect (`?next=`) | **Fixed an open redirect**: `/\t/evil.example` passed the check and browsers turn it into `//evil.example`. Now control characters and backslashes are refused and the result must resolve to this site — unit and browser **tested** |
| Auth email links built from the request's Host header when `SITE_URL` is unset | **Fixed**: production refuses to build links without `SITE_URL` (Supabase's redirect allow-list was the only guard before) |
| Content-Security-Policy | **Added**: per-request nonce with `strict-dynamic` for scripts, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`, connections and images limited to this site and the Supabase project — browser **tested** on every page |
| Other headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; **added** HSTS — **tested** |
| CSV exports | Formula injection neutralised (Phase 8) — **tested** |
| Secrets in the client bundle | None (build output scanned; `sb_secret_` appears only in supabase-js's own guard that refuses secret keys in browsers) |

### Mobile

| Check | Result |
|---|---|
| Secrets in the app bundle | None (same scan) |
| Session storage | Supabase session in SecureStore; cached profile encrypted (Phase 5) |
| Offline data | Local SQLite holds only the signed-in user's sites and work; cleared on sign-out unless work is unsent (Phase 5) |

### Dependencies (`pnpm audit --prod`)

Two moderate advisories, both in Expo's own dependency tree:

- `uuid` < 11.1.1 via `expo › @expo/config-plugins › xcode` — used only by
  iOS build tooling, not shipped in the app. **Accepted.**
- `decode-uri-component` 0.2.2 via `expo-router › query-string` — slow
  decoding of a malformed deep link on the user's own phone. The patched
  release is a breaking major that `query-string` 7 does not support.
  **Accepted** until Expo updates it; re-check on each Expo SDK upgrade.

## Accepted risks and follow-ups

- Browser tests sign in through a test stand-in for Supabase Auth (the
  `e2e/support/gateway.ts` test double); the real Auth service's password
  rules, rate limits and email flows are Supabase's and are configured in the
  project (see `docs/SETUP.md`).
- `style-src 'unsafe-inline'` is required by the charting library and UI
  inline styles; scripts are not affected.
- Functions in the `private` schema (RLS helpers, trigger logic, audit and
  notification writers) are not exposed through the Data API — only `public`
  is — and end users have no direct database connection. Revoking their
  default EXECUTE grant is a possible further hardening step; it needs care
  because RLS policies and non-definer triggers call some of them as the user.

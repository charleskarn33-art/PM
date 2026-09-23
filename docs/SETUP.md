# Setup and Deployment

## Prerequisites

- Node.js 22+, pnpm 10 (`corepack enable`)
- A Supabase project (or the Supabase CLI + Docker for local development)
- For database tests: a PostgreSQL 16 server you can create databases on

```bash
pnpm install
```

## 1. Database (Supabase)

Hosted project:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push          # applies supabase/migrations/*.sql
```

`supabase/seed.sql` contains **demo data only** and is applied automatically by `supabase db reset` on a local stack. Do not run it against production.

Local stack (Docker):

```bash
npx supabase start
npx supabase db reset         # migrations + demo seed
```

### Bootstrap the first Super Admin

Public sign-up is disabled. Create the first user in **Authentication → Users → Add user**, then run in the SQL editor:

```sql
select private.bootstrap_super_admin('admin@your-domain.com');
```

After that, manage everything in the web portal:

- **Admin → Organization**: regions, clusters, counties.
- **Sites**: create/edit sites (Super Admin), assign technicians (Super Admin / Regional Supervisor).
- **Admin → Users**: invite users, set role, activation, home region, region scope (managers and supervisors), technician supervisor/employee code.

Users created directly in the Supabase dashboard start **inactive** (role `viewer`) until a Super Admin activates them in Admin → Users.

### Invitations and password reset (Auth email templates)

Invitations use the Auth admin API, which needs the **secret (service-role) key on the web server only**: set `SUPABASE_SECRET_KEY` in the server environment (never with a `NEXT_PUBLIC_` prefix — the build fails if you do). Without it the invite page is disabled with an explanation.

The web app verifies email links server-side at `/auth/confirm`. In **Authentication → Email Templates**, change the links to:

| Template | Link |
|---|---|
| Invite user | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/set-password` |
| Reset password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/set-password` |

### Scheduled job

Enable the **pg_cron** extension (Database → Extensions) before running the migrations, and the migration schedules `mark_overdue_schedules()` daily at 00:15 UTC. If pg_cron is enabled later, run:

```sql
select cron.schedule('ipt-mark-overdue-pm', '15 0 * * *', 'select public.mark_overdue_schedules()');
```

Set **Authentication → URL configuration → Site URL** to the portal URL, and `SITE_URL` in the web app environment to the same value.

## 2. Web app (`apps/web`)

```bash
cp apps/web/.env.example apps/web/.env.local   # set URL + publishable key
pnpm dev:web                                   # http://localhost:3000
```

Deploy on **Vercel**: root directory `apps/web`, framework Next.js, install command `pnpm install`, and environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SITE_URL` and (server-only, for invitations) `SUPABASE_SECRET_KEY`. Add the production URL to Supabase **Auth → URL configuration**.

PDF reports are rendered on the server (Node runtime, no extra service); they fetch the visit's photos through short-lived signed Storage URLs, so the server must be able to reach the Supabase URL.

## 3. Mobile app (`apps/mobile`)

```bash
cp apps/mobile/.env.example apps/mobile/.env   # set URL + publishable key
pnpm dev:mobile                                # Expo dev server
```

The app uses native modules (SecureStore, SQLite, Crypto, Camera, Location, File System, Image Manipulator, Network, Notifications, Device). Use a development build (`npx expo run:android` / `run:ios` or EAS Build); Expo Go is not enough. Builds for distribution: EAS (`eas build`), with `EXPO_PUBLIC_*` variables set as EAS environment variables.

Permissions (configured in `app.json`): camera (evidence photos) and location while the app is in use (GPS check-in at PM start). Location is never tracked in the background.

**Offline use**: a technician must sign in and sync once with a connection; after that the PM list, sites and checklists work without a connection and changes are sent automatically when the connection returns. Photos are kept in the app's own storage until uploaded. Signing out with unsent work keeps that work on the phone until the same account signs in again.

**Push notifications** (optional; the in-app notification list works without them):

1. App build: run `eas init` so `app.json` has `extra.eas.projectId` (Expo push tokens need it), and configure FCM/APNs credentials with `eas credentials`.
2. Deploy the sender: `supabase functions deploy send-push --no-verify-jwt`, then `supabase secrets set PUSH_FUNCTION_SECRET=<random string>` (and optionally `EXPO_ACCESS_TOKEN` if enhanced push security is enabled in Expo). The function uses the service role key that Supabase provides to Edge Functions; it is never shipped to an app.
3. Call it every minute (Database → Extensions: enable `pg_cron` and `pg_net`):

```sql
select cron.schedule('ipt-send-push', '* * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Authorization', 'Bearer <PUSH_FUNCTION_SECRET>'))
$$);
```

**Reminders** (`system_settings.notifications`): `pm_due_reminder_days` (days before the due date to remind the technician; null = off) and `corrective_action_overdue_enabled`. They are sent by `run_daily_notifications()`, scheduled daily by the migration when pg_cron is enabled; if you enable pg_cron later, schedule it yourself: `select cron.schedule('ipt-daily-notifications', '30 6 * * *', 'select public.run_daily_notifications()');`.

**Settings** (web, Super Admin → Settings): GPS geofence radius and mode (WARN / REQUIRE_REASON / BLOCK), evidence-photo enforcement, DC high-load thresholds (empty = no flag) and consistency rules. Phones pick up changes on their next sync; the server always applies the current settings.

## 4. Checks

```bash
pnpm typecheck          # all packages
pnpm lint
pnpm test               # unit tests (shared, web, mobile)
pnpm tools:postgrest    # once: downloads PostgREST into .tools/ for the API tests
pnpm test:db            # migrations + RLS + workflow tests on PostgreSQL, API tests via PostgREST
pnpm db:types           # regenerate packages/shared/src/database.types.ts after changing migrations
pnpm --filter @ipt/mobile bundle:check   # Metro Android bundle
```

`supabase/tests/src/mobile-sync.test.ts` runs the phone's real offline store and sync code against PostgREST end to end. Unlike the other API tests it commits data, so it uses its own region-C fixtures and deletes what it created. Storage uploads are simulated in that test (storage RLS still applies).

The API tests start PostgREST (the server Supabase uses) against the test database and run the web and mobile query code with a signed JWT per role; every request uses `Prefer: tx=rollback`, so they change nothing. Without the binary they are skipped with a notice.

`pnpm test:db` uses `TEST_DATABASE_ADMIN_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`) and creates/drops the database `ipt_pm_test`. `pnpm db:types` reads from that database, so run `pnpm test:db` first.

## Secrets

- Only the Supabase URL and the **publishable/anon** key are used by the apps. Both apps refuse to start with a secret or service-role key.
- Never commit `.env*` files (they are git-ignored). Never put the service-role key in `apps/web` or `apps/mobile`.

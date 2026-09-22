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

Set **Authentication → URL configuration → Site URL** to the portal URL, and `SITE_URL` in the web app environment to the same value.

## 2. Web app (`apps/web`)

```bash
cp apps/web/.env.example apps/web/.env.local   # set URL + publishable key
pnpm dev:web                                   # http://localhost:3000
```

Deploy on **Vercel**: root directory `apps/web`, framework Next.js, install command `pnpm install`, and environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SITE_URL` and (server-only, for invitations) `SUPABASE_SECRET_KEY`. Add the production URL to Supabase **Auth → URL configuration**.

## 3. Mobile app (`apps/mobile`)

```bash
cp apps/mobile/.env.example apps/mobile/.env   # set URL + publishable key
pnpm dev:mobile                                # Expo dev server
```

The app uses native modules (SecureStore, SQLite, Crypto). Use a development build (`npx expo run:android` / `run:ios` or EAS Build). Builds for distribution: EAS (`eas build`), with `EXPO_PUBLIC_*` variables set as EAS environment variables.

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

The API tests start PostgREST (the server Supabase uses) against the test database and run the web and mobile query code with a signed JWT per role; every request uses `Prefer: tx=rollback`, so they change nothing. Without the binary they are skipped with a notice.

`pnpm test:db` uses `TEST_DATABASE_ADMIN_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`) and creates/drops the database `ipt_pm_test`. `pnpm db:types` reads from that database, so run `pnpm test:db` first.

## Secrets

- Only the Supabase URL and the **publishable/anon** key are used by the apps. Both apps refuse to start with a secret or service-role key.
- Never commit `.env*` files (they are git-ignored). Never put the service-role key in `apps/web` or `apps/mobile`.

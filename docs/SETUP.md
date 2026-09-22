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

Every other user created afterwards starts **inactive** (role `viewer`) until a Super Admin activates them and assigns a role (`public.admin_update_user`). The user administration screens arrive in Phase 2; until then use the SQL editor:

```sql
-- run as the Super Admin via the app, or in the SQL editor:
select public.admin_update_user('<user uuid>', 'technician', true, '<region uuid>');
insert into public.user_region_scopes (profile_id, region_id) values ('<supervisor uuid>', '<region uuid>');
insert into public.site_assignments (site_id, technician_id) values ('<site uuid>', '<technician uuid>');
```

> `admin_update_user` checks that the caller is a Super Admin. From the SQL editor (no JWT) use a direct `update public.profiles …` instead.

## 2. Web app (`apps/web`)

```bash
cp apps/web/.env.example apps/web/.env.local   # set URL + publishable key
pnpm dev:web                                   # http://localhost:3000
```

Deploy on **Vercel**: root directory `apps/web`, framework Next.js, install command `pnpm install`, and environment variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Add the production URL to Supabase **Auth → URL configuration**.

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
pnpm test:db            # migrations + RLS + workflow tests on PostgreSQL
pnpm db:types           # regenerate packages/shared/src/database.types.ts after changing migrations
pnpm --filter @ipt/mobile bundle:check   # Metro Android bundle
```

`pnpm test:db` uses `TEST_DATABASE_ADMIN_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`) and creates/drops the database `ipt_pm_test`. `pnpm db:types` reads from that database, so run `pnpm test:db` first.

## Secrets

- Only the Supabase URL and the **publishable/anon** key are used by the apps. Both apps refuse to start with a secret or service-role key.
- Never commit `.env*` files (they are git-ignored). Never put the service-role key in `apps/web` or `apps/mobile`.

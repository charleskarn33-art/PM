# Deployment runbook (Phase 10)

**Status:** the repository is ready to deploy, but **nothing has been deployed
yet**: the accounts (Supabase, Vercel, Expo, Google Play) belong to IPT
PowerTech and must be created and connected by the owner. This runbook lists
every step; the `Deploy` GitHub workflow automates the repeatable ones.

```
            GitHub Actions: Deploy (manual, per environment)
   ┌──────────── all CI checks (unit, database, browser, builds) ────────────┐
   │                                                                          │
   ▼                                                                          │
 Supabase (staging / production)          Vercel (web)            EAS (Android)
 migrations · Edge Function · checks  →   build · deploy ·    and  build (optional)
                                          health check
```

## Environments

| | Staging | Production |
|---|---|---|
| Supabase project | `ipt-pm-staging` | `ipt-pm-production` |
| Web | Vercel *Preview* deployment | Vercel *Production* (custom domain) |
| Mobile | EAS profile `preview` (APK for internal testers) | EAS profile `production` (Play Store bundle) |
| Data | test/demo data allowed | real data only — the demo seed is never loaded |

Use the **same Supabase region for both projects and for the Vercel functions**
(Vercel → Settings → Functions → Region), chosen for the users' connectivity
(the field teams are in Liberia; check latency from there before choosing).

## 1. One-time setup

### 1.1 Supabase (repeat for staging and production)

1. Create the project (Pro plan recommended for production: daily backups;
   add Point-in-Time Recovery if losing a day of PM data is not acceptable).
2. **Database → Extensions**: enable `pg_cron` and `pg_net` *before* the first
   migration (the migrations schedule the daily jobs when pg_cron is present).
3. **Authentication → Sign In / Providers**: Email enabled; **allow new users
   to sign up: off** (accounts are invited). **Password**: minimum 10 characters;
   enable leaked-password protection if the plan offers it.
4. **Authentication → URL configuration**: Site URL = the web URL
   (e.g. `https://pm.iptpowertech.com`); redirect URLs: the same URL plus
   `iptpm://auth/callback` (as in `supabase/config.toml`).
5. **Authentication → Email templates**: invite and reset links as in
   `docs/SETUP.md` (they go to `/auth/confirm`).
6. **Authentication → SMTP**: configure your own SMTP sender. Supabase's
   built-in sender is rate-limited and meant for testing only; invitations
   and password resets need a real sender in production.
7. Note for the GitHub environment: project ref, database password, and the
   **connection string** (Connect → *Session pooler*) for the read-only
   verification.

### 1.2 GitHub environments

Create environments `staging` and `production` (Settings → Environments;
require a reviewer for `production`). The workflow reads:

| Name | Kind | Used for |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | secret | Supabase CLI (account token: Supabase → Account → Access tokens) |
| `SUPABASE_DB_PASSWORD` | secret | `supabase db push` |
| `SUPABASE_DB_URL` | secret | read-only post-deploy verification (`pnpm verify:deployed`) |
| `SUPABASE_PROJECT_REF` | variable | which project |
| `VERCEL_TOKEN` | secret | Vercel CLI (only if deploying the web app from the workflow) |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | variables | Vercel project (leave `VERCEL_PROJECT_ID` empty to use Vercel's Git integration instead) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | secret | health check through Vercel deployment protection (optional) |
| `EXPO_TOKEN` | secret | EAS builds (Expo → Account settings → Access tokens) |

Never add the Supabase **secret/service-role key** to GitHub for the apps; only
the web server's environment (Vercel) holds it, for invitations.

### 1.3 Vercel (web)

1. Import the repository; **Root Directory** `apps/web`, framework Next.js
   (pnpm workspace is detected).
2. Environment variables (Production and Preview separately):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SITE_URL` (required — the app refuses to build auth email links without it),
   and server-only `SUPABASE_SECRET_KEY` (invitations). The build fails if a
   secret is given a `NEXT_PUBLIC_` name.
3. Add the custom domain; set Supabase's Site URL and `SITE_URL` to it.
4. Choose one deployment path: Vercel's Git integration (automatic preview per
   branch, production on the production branch) **or** the `Deploy` workflow
   (set `VERCEL_PROJECT_ID`, and turn off automatic Git deployments). Do not
   use both for production.

### 1.4 Expo / EAS (Android)

1. `cd apps/mobile && npx eas-cli init` — links the Expo project and writes
   `extra.eas.projectId` and `owner` into `app.json`; commit that change (push
   notifications need the project id).
2. EAS environment variables for `preview` and `production`:
   `npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --visibility plaintext`
   and the same for `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable key
   is public by design; never the secret key).
3. Signing: let EAS generate and keep the Android keystore on the first
   build (`npx eas-cli credentials` to back it up — losing it means a new
   Play listing).
4. Push (FCM): create a Firebase project for the Android package
   `com.iptpowertech.pm` and upload its service-account key with
   `npx eas-cli credentials` (Android → FCM V1).
5. Google Play: create the app in Play Console. The first bundle must be
   uploaded by hand; after that `npx eas-cli submit --profile production`
   uploads to the internal track as a draft (needs a Play service account).

### 1.5 Push delivery (after the first database deploy)

```bash
npx supabase secrets set PUSH_FUNCTION_SECRET=<long random string> --project-ref <ref>
```

Then, in the SQL editor (the secret is kept in Supabase Vault, not in the job):

```sql
select vault.create_secret('<the same long random string>', 'push_function_secret');
select cron.schedule('ipt-send-push', '* * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'push_function_secret')))
$$);
```

## 2. First deployment

1. Complete section 1 for **staging**.
2. GitHub → Actions → **Deploy** → `staging` (tick *mobile* for a test APK).
   The workflow runs every CI check, applies the migrations, deploys the Edge
   Function, verifies the database and deploys the web app.
3. Bootstrap the first Super Admin (Supabase → Authentication → Add user, then
   `select private.bootstrap_super_admin('you@your-domain.com');`).
4. Set up push delivery (1.5).
5. Run `DEPLOY_DATABASE_URL=… DEPLOY_ENV=staging pnpm verify:deployed`
   locally or re-run the workflow: expect no failures.
6. Smoke test (section 5), then run the device test plan
   (`docs/DEVICE_TESTING.md`) with the preview APK.
7. Repeat 1–5 for **production**. Enter the real organisation (regions,
   clusters, counties, sites, users) in the portal; the demo seed is never
   loaded in production.

## 3. Every release

1. Merge to the main branch with CI green.
2. **Deploy → staging**, smoke test.
3. **Deploy → production** (a reviewer approves the environment).
4. Mobile releases only when the app changed: Deploy with *mobile* ticked (or
   `eas build --profile production`), then `eas submit`, and roll out in Play
   Console in stages (for example 20% → 100%).

**Compatibility rule:** phones update slowly and keep working offline. A
database migration must keep working with the web app currently deployed
and with every app version still in the field: add columns and functions,
do not rename or remove ones an older app uses (`mobile_sync_bundle`, the
tables the outbox writes to) until those versions are retired.

## 4. Rollback

- **Web**: Vercel → Deployments → promote the previous deployment (instant).
- **Database**: migrations are forward-only. Fix forward with a new
  migration. Restore a backup / PITR only for data loss — it also discards
  everything written since.
- **Mobile**: an installed build cannot be recalled; halt the staged rollout
  in Play Console and ship a fixed build. (Over-the-air updates are not set up.)

## 5. Smoke test after each deployment

- [ ] `https://<web>/api/health` → `{"status":"ok","supabase":"ok"}`.
- [ ] `pnpm verify:deployed` → 0 failed.
- [ ] Sign in as Super Admin; dashboard, sites, analytics, reports load.
- [ ] A supervisor sees only their regions; a technician's menu has no admin pages.
- [ ] Open a PM report PDF and a CSV export.
- [ ] Phone (preview/production build): sign in, sync, start and submit a test PM on a test site; the supervisor sees it.
- [ ] Supabase → Database → Cron: last runs succeeded
      (`select jobname, status, start_time from cron.job_run_details join cron.job using (jobid) order by start_time desc limit 10;`).

## 6. Monitoring

- Uptime monitor on `/api/health` (returns 503 when Supabase is unreachable).
- Vercel → Logs (web errors, server actions, PDF rendering).
- Supabase → Logs (API, Auth, Postgres) and Edge Functions → `send-push` logs.
- Supabase → Reports / Advisors (security and performance advisors) after
  each migration.

# Local development setup

Requirements: Node.js 22.13+, pnpm 10 (`corepack enable`), MySQL 8 (installed
locally, or in Docker with `docker/docker-compose.dev.yml`).

## 1. Database

Either run MySQL in Docker (bound to 127.0.0.1 only):

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

or use a local MySQL 8 server and create the databases and a user limited to them:

```sql
CREATE DATABASE ipt_pm        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE ipt_pm_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; -- prisma migrate dev
CREATE DATABASE ipt_pm_test   CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; -- integration tests
CREATE USER 'ipt_pm'@'localhost' IDENTIFIED BY '<password>';
GRANT ALL PRIVILEGES ON ipt_pm.*        TO 'ipt_pm'@'localhost';
GRANT ALL PRIVILEGES ON ipt_pm_shadow.* TO 'ipt_pm'@'localhost';
GRANT ALL PRIVILEGES ON ipt_pm_test.*   TO 'ipt_pm'@'localhost';
-- The migrations create triggers as this (non-SUPER) user; with binary logging
-- on (the MySQL 8 default) that needs:
SET PERSIST log_bin_trust_function_creators = 1;
```

The Docker configurations set `log_bin_trust_function_creators` in
`docker/mysql/conf.d/ipt-pm.cnf`. The integration tests refuse any database
whose name does not end in `_test`.

## 2. Environment

```bash
cp .env.example .env     # never committed
```

Fill in the database URLs and two different random JWT secrets
(`openssl rand -base64 48`). The API validates every variable at start and
names any that are missing or unsafe (values are never printed).

## 3. Install, generate, run

```bash
pnpm install              # also generates the Prisma client
pnpm db:status            # Prisma can reach MySQL, migrations pending?
pnpm db:deploy            # apply the migrations (production-style, non-destructive)
pnpm db:seed              # roles, permissions and grants (idempotent)
pnpm db:seed:demo         # optional: Tienii 1301 DEMO data (refused when NODE_ENV=production)
pnpm db:create-admin --email you@example.com --name "Your Name"   # first Super Admin
pnpm dev:api              # http://localhost:3001/api/v1/health
```

`db:create-admin` asks for the password at a hidden prompt (or reads
`ADMIN_INITIAL_PASSWORD` for unattended setups — never a command-line
argument) and works only while no active Super Admin exists. Everyone else is
created by an administrator in the app, who gives them a temporary password
(`POST /users/:id/temporary-password`); they must choose their own at the
first sign-in.

Demo records carry `is_demo = 1` and use the reserved `.invalid` e-mail
domain; `pnpm db:seed:demo --remove` deletes them again. Schema changes are
made with `pnpm db:migrate` (creates a migration with `prisma migrate dev`
against the shadow database, then regenerates the client).

The endpoints are listed in [`API.md`](API.md). Everything except health,
sign-in, refresh and sign-out requires `Authorization: Bearer <access token>`.

### Web and mobile

```bash
# apps/web/.env.local
API_URL=http://localhost:3001
WEB_FORWARD_SECRET=<same value as in the API's .env, optional>

# apps/mobile/.env
EXPO_PUBLIC_API_URL=http://10.0.2.2:3001   # Android emulator → this machine; https:// for real servers
```

The web app's server calls the API and keeps the tokens in httpOnly cookies;
page scripts never see them. The mobile app keeps them in SecureStore. The
pages and phone screens not yet moved to the API (Phases 4–9) still read the
archived Supabase backend and show no data without it.

## 4. Checks

```bash
pnpm --filter @ipt/api typecheck
pnpm --filter @ipt/api lint
pnpm --filter @ipt/api test          # unit tests
pnpm test:api                        # integration tests (needs TEST_DATABASE_URL)
pnpm --filter @ipt/api build
pnpm exec prisma validate
```

Apart from sign-in, sign-out, password change and the profile page, the
web and mobile apps still read data from the archived Supabase backend (see
`docs/legacy/`) until they are moved to this API (Phases 4–9). The browser
suite in `e2e/` belongs to that backend and is rebuilt on the API in Phase 14.

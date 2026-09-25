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
```

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
pnpm db:status            # Prisma can reach MySQL
pnpm dev:api              # http://localhost:3001/api/v1/health
```

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health` | liveness (no dependencies) |
| `GET /api/v1/health/ready` | readiness: MySQL reachable (503 otherwise) |

Every other route requires `Authorization: Bearer <access token>`
(login arrives in Phase 3).

## 4. Checks

```bash
pnpm --filter @ipt/api typecheck
pnpm --filter @ipt/api lint
pnpm --filter @ipt/api test          # unit tests
pnpm test:api                        # integration tests (needs TEST_DATABASE_URL)
pnpm --filter @ipt/api build
pnpm exec prisma validate
```

The web and mobile apps still read data from the archived Supabase backend
(see `docs/legacy/`) until they are moved to this API (Phases 3, 6–9).

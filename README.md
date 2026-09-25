# IPT PowerTech PM System

Telecom site power **preventive maintenance** platform for IPT PowerTech Liberia: a technician mobile app, a web portal for supervisors, managers and administrators, and a REST API.

Architecture (2026-09-25): **NestJS REST API + MySQL 8 + Prisma**, JWT
access/refresh tokens, server-controlled file storage, Next.js web and an
offline-first Expo app. The mobile app and web never reach the database —
only the API does. Plan and phases: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

| Path | Stack |
|---|---|
| `apps/api` | NestJS 12, Prisma 7 (MySQL 8), JWT, pino logging |
| `apps/web` | Next.js 16, Tailwind v4 — moving from the archived Supabase backend to the API |
| `apps/mobile` | Expo SDK 57, Expo Router, SQLite offline store, SecureStore — moving to the API |
| `packages/shared` | Domain logic and validation shared by all apps |
| `prisma/` | Schema and migrations |
| `docker/` | API image, Compose stack (nginx, API, MySQL), nginx and MySQL config |
| `docs/legacy/` | The superseded Supabase implementation (reference only) |

- Local setup: [`docs/SETUP.md`](docs/SETUP.md) · VPS: [`docs/DEPLOYMENT_VPS.md`](docs/DEPLOYMENT_VPS.md)

```bash
pnpm install
pnpm dev:api        # http://localhost:3001/api/v1/health/ready
```

The PM checklist structure and terminology follow the Tienii (1301) Preventative Maintenance Report (2026-09-15). Tienii is included only as flagged **demo** data.

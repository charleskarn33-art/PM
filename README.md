# IPT PowerTech PM System

Telecom site power **preventive maintenance** platform for IPT PowerTech Liberia: a technician mobile app, a web portal for supervisors/managers/administrators, and a Supabase backend secured with Row Level Security.

| Package | Stack |
|---|---|
| `apps/web` | Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui-style components |
| `apps/mobile` | Expo SDK 57, React Native, Expo Router, SecureStore, SQLite |
| `packages/shared` | Generated database types and shared domain logic |
| `supabase` | PostgreSQL migrations, RLS policies, storage policies, demo seed, database tests |

- Architecture, data model, security model, offline design and phase plan: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- Setup, admin bootstrap and deployment: [`docs/SETUP.md`](docs/SETUP.md)

```bash
pnpm install
pnpm check      # typecheck + lint + unit tests + database tests
```

The PM checklist structure and terminology follow the Tienii (1301) Preventative Maintenance Report (2026-09-15). Tienii is included only as flagged **demo** data.

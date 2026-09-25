# Superseded: Supabase implementation

These documents describe the first implementation (Supabase: PostgreSQL with
row-level security, Supabase Auth, Storage and Edge Functions). On 2026-09-25
the architecture changed to **NestJS + MySQL 8 + Prisma** with JWT
authentication and server-controlled file storage — see
[`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md).

The Supabase code (`supabase/`, the Supabase data access in `apps/web` and
`apps/mobile`, `e2e/` and `supabase/tests/`) stays in the repository only as a
reference while each area is rebuilt on the new API, and is removed phase by
phase. It is not deployed.

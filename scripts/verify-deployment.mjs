#!/usr/bin/env node
/**
 * Read-only checks of a deployed database (run after every deployment).
 *
 *   DEPLOY_DATABASE_URL=postgres://... [DEPLOY_DATABASE_CA=prod-ca.crt] [DEPLOY_ENV=production] pnpm verify:deployed
 *
 * Use the project's connection string (Supabase → Connect). The script opens a
 * READ ONLY transaction, so it cannot change anything. Exit code 1 when any
 * check fails; warnings do not fail the run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DEPLOY_DATABASE_URL;
const env = process.env.DEPLOY_ENV ?? 'production';
if (!url) {
  console.error('Set DEPLOY_DATABASE_URL to the database connection string.');
  process.exit(2);
}

const migrationsDir = fileURLToPath(new URL('../supabase/migrations', import.meta.url));
const repoVersions = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.split('_')[0])
  .sort();

const results = [];
const record = (status, check, detail = '') => results.push({ status, check, detail });

// TLS: with DEPLOY_DATABASE_CA (Supabase → Database settings → SSL certificate)
// the server certificate is verified; otherwise the connection string's sslmode applies.
const ca = process.env.DEPLOY_DATABASE_CA;
const client = new pg.Client({ connectionString: url, ...(ca ? { ssl: { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true } } : {}) });
await client.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const exists = async (sql, params = []) => (await q(sql, params)).length > 0;

try {
  await client.query('begin transaction read only');

  // --- Migrations ------------------------------------------------------------
  if (await exists(`select 1 from information_schema.tables where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'`)) {
    const applied = new Set((await q('select version from supabase_migrations.schema_migrations')).map((r) => r.version));
    const missing = repoVersions.filter((v) => !applied.has(v));
    const unknown = [...applied].filter((v) => !repoVersions.includes(v));
    if (missing.length) record('FAIL', 'All repository migrations are applied', `missing: ${missing.join(', ')}`);
    else record('PASS', 'All repository migrations are applied', `${repoVersions.length} migrations`);
    if (unknown.length) record('WARN', 'No migrations applied outside the repository', unknown.join(', '));
  } else {
    record('SKIP', 'All repository migrations are applied', 'no supabase_migrations table (not a Supabase project)');
  }

  // --- Security baseline (same rules as supabase/tests/src/security.test.ts) --
  const list = (rows, key) => rows.map((r) => r[key]).join(', ');
  const checks = [
    ['RLS enabled on every public table',
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`, 'relname'],
    ['Every public table has a policy',
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`, 'relname'],
    ['SECURITY DEFINER functions pin search_path',
      `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('public', 'private') and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`, 'fn'],
    ['Anonymous callers have no table privileges',
      `select distinct table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`, 'table_name'],
    ['Anonymous callers cannot execute public functions',
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`, 'proname'],
    ['Views run with the caller’s permissions',
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v', 'm') and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)`, 'relname'],
    ['App users hold no TRUNCATE / REFERENCES / TRIGGER privilege',
      `select distinct table_name from information_schema.role_table_grants where table_schema = 'public' and grantee in ('authenticated', 'anon') and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`, 'table_name'],
  ];
  for (const [name, sql, key] of checks) {
    const rows = await q(sql);
    record(rows.length ? 'FAIL' : 'PASS', name, rows.length ? list(rows, key) : '');
  }
  record(
    (await exists(`select 1 from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass`)) ? 'PASS' : 'FAIL',
    'New sign-ins get an (inactive) profile',
  );

  // --- Storage ---------------------------------------------------------------
  const buckets = await q(`select id, public from storage.buckets where id in ('pm-photos', 'site-documents')`);
  const missingBuckets = ['pm-photos', 'site-documents'].filter((b) => !buckets.some((r) => r.id === b));
  const publicBuckets = buckets.filter((r) => r.public).map((r) => r.id);
  record(missingBuckets.length || publicBuckets.length ? 'FAIL' : 'PASS', 'Storage buckets exist and are private',
    [missingBuckets.length && `missing: ${missingBuckets.join(', ')}`, publicBuckets.length && `public: ${publicBuckets.join(', ')}`].filter(Boolean).join('; '));

  // --- Scheduled jobs ----------------------------------------------------------
  if (await exists(`select 1 from pg_extension where extname = 'pg_cron'`)) {
    const jobs = new Set((await q('select jobname from cron.job')).map((r) => r.jobname));
    for (const [job, what, level] of [
      ['ipt-mark-overdue-pm', 'Daily overdue-PM marking is scheduled', 'FAIL'],
      ['ipt-daily-notifications', 'Daily reminders are scheduled', 'FAIL'],
      ['ipt-send-push', 'Push delivery is scheduled (optional)', 'WARN'],
    ]) record(jobs.has(job) ? 'PASS' : level, what, jobs.has(job) ? '' : `cron job ${job} not found (docs/DEPLOYMENT.md)`);
  } else {
    record('FAIL', 'pg_cron is enabled', 'enable pg_cron, then schedule the jobs (docs/DEPLOYMENT.md)');
  }

  // --- Application data ----------------------------------------------------------
  record((await exists(`select 1 from public.pm_templates where status = 'ACTIVE'`)) ? 'PASS' : 'FAIL', 'An active PM template exists');
  const admins = Number((await q(`select count(*) as n from public.profiles where role = 'super_admin' and is_active`))[0].n);
  record(admins > 0 ? 'PASS' : 'WARN', 'At least one active Super Admin', admins > 0 ? `${admins}` : 'bootstrap the first Super Admin (docs/DEPLOYMENT.md)');
  const demo = Number((await q(`select count(*) as n from public.sites where is_demo`))[0].n);
  if (demo > 0) record(env === 'production' ? 'WARN' : 'PASS', 'No demo data in production', `${demo} demo site(s) present (${env})`);
  else record('PASS', 'No demo data in production');
} finally {
  await client.query('rollback').catch(() => undefined);
  await client.end();
}

const width = Math.max(...results.map((r) => r.check.length));
for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
const warned = results.filter((r) => r.status === 'WARN').length;
console.log(`\n${failed} failed, ${warned} warning(s), ${results.length} checks.`);
process.exit(failed ? 1 : 0);

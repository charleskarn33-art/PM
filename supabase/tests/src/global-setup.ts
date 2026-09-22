import pg from 'pg';
import { ADMIN_URL, TEST_DB_NAME, ids, readSql, schemaSqlFiles, testDbUrl } from './db';
import { startPostgrest } from './postgrest';

/**
 * Builds a fresh test database: Supabase shim + all migrations + seed, then
 * role fixtures. Fails loudly if any migration errors.
 */
export default async function setup(): Promise<() => void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB_NAME} with (force)`);
  await admin.query(`create database ${TEST_DB_NAME}`);
  await admin.end();

  const db = new pg.Client({ connectionString: testDbUrl() });
  await db.connect();
  try {
    for (const file of schemaSqlFiles()) {
      try {
        await db.query(readSql(file));
      } catch (error) {
        throw new Error(`Failed applying ${file}: ${(error as Error).message}`);
      }
    }
    await db.query(fixturesSql());
  } finally {
    await db.end();
  }

  // API integration tests run through a real PostgREST when the binary is
  // available (pnpm tools:postgrest); otherwise they are skipped with a notice.
  const pgrst = await startPostgrest(ADMIN_URL);
  if (!pgrst) console.warn('PostgREST binary not found: API integration tests will be skipped (run pnpm tools:postgrest).');
  return () => {
    pgrst?.kill();
  };
}

function fixturesSql(): string {
  const users: Array<[string, string, string, boolean, string | null]> = [
    [ids.admin, 'admin@test.local', 'super_admin', true, null],
    [ids.viewer, 'viewer@test.local', 'viewer', true, null],
    [ids.managerA, 'manager.a@test.local', 'regional_manager', true, ids.regionA],
    [ids.supervisorA, 'supervisor.a@test.local', 'regional_supervisor', true, ids.regionA],
    [ids.supervisorB, 'supervisor.b@test.local', 'regional_supervisor', true, ids.regionB],
    [ids.techA, 'tech.a@test.local', 'technician', true, ids.regionA],
    [ids.techB, 'tech.b@test.local', 'technician', true, ids.regionB],
    [ids.maintenance, 'maintenance@test.local', 'maintenance', true, null],
    [ids.inactiveTech, 'inactive@test.local', 'technician', true, ids.regionA],
  ];

  const userSql = users
    .map(
      ([id, email, role, active, region]) => `
      insert into auth.users (id, email, raw_user_meta_data)
        values ('${id}', '${email}', '{"full_name": "${email.split('@')[0]}"}');
      update public.profiles set role = '${role}', is_active = ${active},
        region_id = ${region ? `'${region}'` : 'null'} where id = '${id}';`,
    )
    .join('\n');

  return `
    insert into public.regions (id, code, name) values
      ('${ids.regionA}', 'RA', 'Region A'),
      ('${ids.regionB}', 'RB', 'Region B');
    insert into public.clusters (id, region_id, code, name) values
      ('${ids.clusterA}', '${ids.regionA}', 'CA1', 'Cluster A1');
    insert into public.counties (id, cluster_id, code, name) values
      ('${ids.countyA}', '${ids.clusterA}', 'CTA1', 'County A1');

    ${userSql}

    insert into public.supervisors (id) values ('${ids.supervisorA}'), ('${ids.supervisorB}');
    insert into public.technicians (id, region_id, supervisor_id) values
      ('${ids.techA}', '${ids.regionA}', '${ids.supervisorA}'),
      ('${ids.techB}', '${ids.regionB}', '${ids.supervisorB}'),
      ('${ids.inactiveTech}', '${ids.regionA}', '${ids.supervisorA}');
    insert into public.user_region_scopes (profile_id, region_id) values
      ('${ids.managerA}', '${ids.regionA}'),
      ('${ids.supervisorA}', '${ids.regionA}'),
      ('${ids.supervisorB}', '${ids.regionB}');

    insert into public.sites (id, site_code, site_name, region_id, county_id, latitude, longitude,
                              generator_available, supervisor_id) values
      ('${ids.siteA1}', 'T-A1', 'Test Site A1', '${ids.regionB}', '${ids.countyA}', 7.0, -11.0, true, '${ids.supervisorA}'),
      ('${ids.siteA2}', 'T-A2', 'Test Site A2', '${ids.regionA}', null, null, null, false, '${ids.supervisorA}'),
      ('${ids.siteB1}', 'T-B1', 'Test Site B1', '${ids.regionB}', null, null, null, false, '${ids.supervisorB}');

    insert into public.site_assignments (site_id, technician_id) values
      ('${ids.siteA1}', '${ids.techA}'),
      ('${ids.siteB1}', '${ids.techB}'),
      ('${ids.siteA1}', '${ids.inactiveTech}');

    -- Deactivated after being assigned (assignments require an active technician).
    update public.profiles set is_active = false where id = '${ids.inactiveTech}';
  `;
}

import { afterAll, describe, expect, it } from 'vitest';
import { actAs, activeTemplateId, addPhoto, createVisitAs, getPool, ids, inTx, itemId, tryQuery, type Client } from './db';

afterAll(async () => {
  await getPool().end();
});

// Test Site A1 is at (7.0, -11.0).
const NEAR = [7.0003, -11.0]; // ~33 m
const FAR = [7.01, -11.0]; // ~1.1 km

async function setGeofence(c: Client, mode: string, radius = 100) {
  await actAs(c, ids.admin);
  await c.query(`update public.system_settings set value = $1 where key = 'geofence'`, [JSON.stringify({ radius_m: radius, mode })]);
}

async function startVisit(c: Client, pos: number[] | null, extra: Record<string, unknown> = {}, siteId: string = ids.siteA1) {
  const templateId = await activeTemplateId(c);
  await actAs(c, ids.techA);
  const cols = ['site_id', 'template_id', 'technician_id', 'gps_latitude', 'gps_longitude', 'gps_accuracy_m', ...Object.keys(extra)];
  const vals = [siteId, templateId, ids.techA, pos?.[0] ?? null, pos?.[1] ?? null, pos ? 8 : null, ...Object.values(extra)];
  return tryQuery(
    c,
    `insert into public.pm_visits (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     returning id, gps_status, round(gps_distance_m)::int as distance, gps_radius_m, geofence_mode`,
    vals,
  );
}

describe('GPS geofence at PM start', () => {
  it('records position, distance and status computed by the server', async () => {
    await inTx(async (c) => {
      const res = await startVisit(c, NEAR, { gps_status: 'OUTSIDE_RADIUS', gps_distance_m: 99999 });
      expect(res.error).toBeUndefined();
      expect(res.rows[0]).toMatchObject({ gps_status: 'WITHIN_RADIUS', distance: 33, gps_radius_m: 100, geofence_mode: 'WARN' });
    });
  });

  it('WARN records an outside check-in without blocking', async () => {
    await inTx(async (c) => {
      const res = await startVisit(c, FAR);
      expect(res.rows[0]).toMatchObject({ gps_status: 'OUTSIDE_RADIUS', geofence_mode: 'WARN' });
      expect(res.rows[0]!.distance as number).toBeGreaterThan(1000);
    });
  });

  it('REQUIRE_REASON needs a reason when outside', async () => {
    await inTx(async (c) => {
      await setGeofence(c, 'REQUIRE_REASON');
      expect((await startVisit(c, FAR)).error?.message).toMatch(/A reason is required/);
      const ok = await startVisit(c, FAR, { outside_radius_reason: 'Site gate relocated; road access 1 km north.' });
      expect(ok.rows[0]).toMatchObject({ gps_status: 'OUTSIDE_RADIUS', geofence_mode: 'REQUIRE_REASON' });
    });
  });

  it('BLOCK rejects outside or missing GPS, but uses the site radius override', async () => {
    await inTx(async (c) => {
      await setGeofence(c, 'BLOCK');
      expect((await startVisit(c, FAR)).error?.message).toMatch(/outside the configured site radius/);
      expect((await startVisit(c, null)).error?.message).toMatch(/location is unavailable/);
      await actAs(c, ids.admin);
      await c.query(`update public.sites set geofence_radius_m = 2000 where id = $1`, [ids.siteA1]);
      expect((await startVisit(c, FAR)).rows[0]).toMatchObject({ gps_status: 'WITHIN_RADIUS', gps_radius_m: 2000 });
    });
  });

  it('never blocks at a site without coordinates', async () => {
    await inTx(async (c) => {
      await setGeofence(c, 'BLOCK');
      await c.query(`insert into public.site_assignments (site_id, technician_id) values ($1, $2)`, [ids.siteA2, ids.techA]);
      const res = await startVisit(c, FAR, {}, ids.siteA2);
      expect(res.rows[0]).toMatchObject({ gps_status: 'SITE_HAS_NO_COORDINATES', distance: null });
    });
  });

  it('GPS data cannot be changed after start except by a Super Admin', async () => {
    await inTx(async (c) => {
      const id = (await startVisit(c, FAR)).rows[0]!.id;
      const res = await tryQuery(c, `update public.pm_visits set gps_latitude = 7.0, gps_longitude = -11.0 where id = $1`, [id]);
      expect(res.error?.message).toMatch(/GPS check-in data cannot be changed/);
      await actAs(c, ids.admin);
      expect((await tryQuery(c, `update public.pm_visits set outside_radius_reason = 'Corrected by admin' where id = $1`, [id])).error).toBeUndefined();
    });
  });
});

describe('photo evidence', () => {
  it('accepts the metadata row only after the file is uploaded', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const item = await itemId(c, 'gen_burning_oil');
      const path = `${ids.siteA1}/${visitId}/p1.jpg`;
      const early = await tryQuery(
        c,
        `insert into public.pm_photos (site_id, visit_id, checklist_item_id, file_path, taken_at) values ($1, $2, $3, $4, now())`,
        [ids.siteA1, visitId, item, path],
      );
      expect(early.error?.message).toMatch(/has not been uploaded yet/);

      await addPhoto(c, { siteId: ids.siteA1, visitId, itemId: item, path, ownerId: ids.techA });
      const { rows } = await c.query(`select uploaded_at is not null as uploaded from public.pm_photos where file_path = $1`, [path]);
      expect(rows).toEqual([{ uploaded: true }]);
    });
  });
});

describe('mobile_sync_bundle', () => {
  it('returns the technician’s offline data within their scope only', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await c.query(
        `insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, answer) values ($1, $2, '', 'YES')`,
        [visitId, await itemId(c, 'gen_radiator')],
      );
      const { rows } = await c.query(`select public.mobile_sync_bundle() as b`);
      const b = rows[0].b;
      expect(b.sites.map((s: { site_code: string }) => s.site_code)).toEqual(['T-A1']);
      expect(b.templates).toHaveLength(1);
      expect(b.templates[0].sections).toHaveLength(6);
      expect(b.templates[0].sections[0].items).toHaveLength(16);
      expect(b.templates[0].sections[1].fields).toHaveLength(6);
      expect(b.visits.map((v: { id: string }) => v.id)).toEqual([visitId]);
      expect(b.visits[0].responses).toHaveLength(1);
      expect(Object.keys(b.settings).sort()).toEqual(['dc_thresholds', 'geofence', 'pm_submission']);
      expect(b.sites[0]).toMatchObject({ region_name: expect.any(String), geofence_radius_m: null }); // overview columns for offline display
      expect(b.consistency_rules).toHaveLength(3);

      await actAs(c, ids.techB);
      const other = (await c.query(`select public.mobile_sync_bundle() as b`)).rows[0].b;
      expect(other.visits).toEqual([]);
      expect(other.sites.map((s: { site_code: string }) => s.site_code)).toEqual(['T-B1']);

      await actAs(c, 'anon');
      expect((await tryQuery(c, `select public.mobile_sync_bundle()`)).error?.code).toBe('42501');
    });
  });
});

describe('settings administration', () => {
  it('validates setting values in the database', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const set = (key: string, value: unknown) =>
        tryQuery(c, `update public.system_settings set value = $2 where key = $1`, [key, JSON.stringify(value)]);
      expect((await set('geofence', { radius_m: 250, mode: 'BLOCK' })).error).toBeUndefined();
      expect((await set('geofence', { radius_m: 0, mode: 'BLOCK' })).error?.message).toMatch(/radius/);
      expect((await set('geofence', { radius_m: 10.5, mode: 'WARN' })).error?.message).toMatch(/whole number/);
      expect((await set('geofence', { radius_m: 100, mode: 'SOMETIMES' })).error?.message).toMatch(/mode/);
      expect((await set('dc_thresholds', { high_load_kw: 3.5, high_load_current_a: null })).error).toBeUndefined();
      expect((await set('dc_thresholds', { high_load_kw: -1, high_load_current_a: null })).error?.message).toMatch(/greater than 0/);
      expect((await set('dc_thresholds', { high_load_kw: null })).error?.message).toMatch(/missing/);
      expect((await set('pm_submission', { enforce_photo_requirements: 'yes' })).error?.message).toMatch(/true or false/);
    });
  });

  it('only a Super Admin may change settings or consistency rules', async () => {
    await inTx(async (c) => {
      for (const who of [ids.managerA, ids.supervisorA, ids.techA, ids.viewer]) {
        await actAs(c, who);
        const upd = await tryQuery(c, `update public.system_settings set value = '{"radius_m": 5, "mode": "BLOCK"}' where key = 'geofence' returning key`);
        expect(upd.error ?? upd.rows.length).toBe(0);
        const ins = await tryQuery(c, `insert into public.pm_consistency_rules (lhs_key, operator, rhs_key, message)
                                       values ('solar.panels_operational', '<', 'solar.panels_installed', 'x')`);
        expect(ins.error?.code).toBe('42501');
      }
    });
  });

  it('consistency rules must compare two known recorded values', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const add = (lhs: string, rhs: string, message = 'm') =>
        tryQuery(c, `insert into public.pm_consistency_rules (lhs_key, operator, rhs_key, message) values ($1, '<', $2, $3)`, [lhs, rhs, message]);
      expect((await add('solar.panels_operational', 'solar.panels_installed', 'Fewer operational than installed')).error).toBeUndefined();
      expect((await add('no.such_key', 'solar.panels_installed')).error?.message).toMatch(/Unknown value key/);
      expect((await add('solar.panels_installed', 'solar.panels_installed')).error?.message).toMatch(/two different/);
      expect((await add('dc.dc_modules_installed', 'solar.panels_installed', '   ')).error?.message).toMatch(/message/);

      const keys = await c.query(`select analytics_key, source from public.pm_value_keys order by 1`);
      expect(keys.rows.map((r) => r.analytics_key)).toEqual(expect.arrayContaining(['dc.dc_modules_installed', 'solar.panels_installed']));
      expect(new Set(keys.rows.map((r) => r.analytics_key)).size).toBe(keys.rows.length);
    });
  });
});

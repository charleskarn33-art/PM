import { afterAll, describe, expect, it } from 'vitest';
import { actAs, activeTemplateId, addPhoto, createVisitAs, getPool, ids, inTx, relaxRequirements, tryQuery, type Client } from './db';

afterAll(async () => {
  await getPool().end();
});

async function visibleSiteCodes(c: Client, userId: string): Promise<string[]> {
  await actAs(c, userId);
  const { rows } = await c.query<{ site_code: string }>(
    `select site_code from public.sites where site_code like 'T-%' order by site_code`,
  );
  return rows.map((r) => r.site_code);
}

describe('site visibility by role', () => {
  it.each([
    ['super admin', ids.admin, ['T-A1', 'T-A2', 'T-B1']],
    ['viewer (org-wide read)', ids.viewer, ['T-A1', 'T-A2', 'T-B1']],
    ['regional manager A', ids.managerA, ['T-A1', 'T-A2']],
    ['regional supervisor A', ids.supervisorA, ['T-A1', 'T-A2']],
    ['regional supervisor B', ids.supervisorB, ['T-B1']],
    ['technician A (assigned A1)', ids.techA, ['T-A1']],
    ['technician B (assigned B1)', ids.techB, ['T-B1']],
    ['maintenance (no assigned actions)', ids.maintenance, []],
    ['inactive technician', ids.inactiveTech, []],
  ])('%s', async (_label, userId, expected) => {
    await inTx(async (c) => {
      expect(await visibleSiteCodes(c, userId)).toEqual(expected);
    });
  });

  it('technician loses access when the assignment ends', async () => {
    await inTx(async (c) => {
      await c.query(
        `update public.site_assignments set ends_on = current_date - 1, starts_on = current_date - 10
          where technician_id = $1`,
        [ids.techA],
      );
      expect(await visibleSiteCodes(c, ids.techA)).toEqual([]);
    });
  });

  it('maintenance user sees the site of a corrective action assigned to them', async () => {
    await inTx(async (c) => {
      await c.query(
        `insert into public.corrective_actions (site_id, category, description, assigned_to)
         values ($1, 'GENERATOR', 'Replace radiator hose', $2)`,
        [ids.siteB1, ids.maintenance],
      );
      expect(await visibleSiteCodes(c, ids.maintenance)).toEqual(['T-B1']);
    });
  });
});

describe('write permissions on organisation data', () => {
  it('only super admin can create regions and sites', async () => {
    await inTx(async (c) => {
      for (const user of [ids.viewer, ids.managerA, ids.supervisorA, ids.techA]) {
        await actAs(c, user);
        const res = await tryQuery(c, `insert into public.regions (code, name) values ('X', 'X')`);
        expect(res.error?.message, user).toMatch(/row-level security/);
      }
      await actAs(c, ids.admin);
      const ok = await tryQuery(c, `insert into public.regions (code, name) values ('X', 'X') returning id`);
      expect(ok.error).toBeUndefined();
    });
  });

  it('supervisor can assign technicians only to sites in scope', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const inScope = await tryQuery(
        c,
        `insert into public.site_assignments (site_id, technician_id) values ($1, $2)`,
        [ids.siteA2, ids.techA],
      );
      expect(inScope.error).toBeUndefined();
      const outOfScope = await tryQuery(
        c,
        `insert into public.site_assignments (site_id, technician_id) values ($1, $2)`,
        [ids.siteB1, ids.techA],
      );
      expect(outOfScope.error?.message).toMatch(/row-level security/);
    });
  });

  it('supervisor can schedule PM in scope; manager (read-only) cannot', async () => {
    await inTx(async (c) => {
      const templateId = await activeTemplateId(c);
      const sql = `insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date)
                   values ($1, $2, $3, current_date, current_date + 7)`;
      await actAs(c, ids.supervisorA);
      expect((await tryQuery(c, sql, [ids.siteA1, templateId, ids.techA])).error).toBeUndefined();
      expect((await tryQuery(c, sql, [ids.siteB1, templateId, ids.techB])).error?.message).toMatch(
        /row-level security/,
      );
      await actAs(c, ids.managerA);
      expect((await tryQuery(c, sql, [ids.siteA1, templateId, ids.techA])).error?.message).toMatch(
        /row-level security/,
      );
    });
  });

  it('checklist configuration is admin-only', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const res = await tryQuery(
        c,
        `update public.pm_checklist_items set prompt = 'changed' where code = 'gen_burning_oil'`,
      );
      expect(res.rowCount).toBe(0);
      await actAs(c, ids.admin);
      const ok = await tryQuery(
        c,
        `update public.pm_checklist_items set is_active = false where code = 'gen_burning_oil'`,
      );
      expect(ok.rowCount).toBe(1);
    });
  });
});

describe('PM data behind a corrective action', () => {
  it('maintenance reads the PM, answers, readings, photos and notes of their action — and nothing else', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const other = await createVisitAs(c, ids.techA, ids.siteA1);
      for (const v of [visitId, other]) {
        await c.query(
          `insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, answer)
           select $1, i.id, '', 'YES' from public.pm_checklist_items i join public.pm_sections s on s.id = i.section_id
             join public.pm_templates t on t.id = s.template_id and t.status = 'ACTIVE' where i.code = 'gen_radiator'`,
          [v],
        );
      }
      await addPhoto(c, { siteId: ids.siteA1, visitId, itemId: null, path: `${ids.siteA1}/${visitId}/m.jpg`, ownerId: ids.techA });
      await relaxRequirements(c);
      await actAs(c, ids.techA);
      await c.query(`update public.pm_visits set status = 'SUBMITTED' where id = any($1)`, [[visitId, other]]);
      await actAs(c, ids.supervisorA);
      const action = (
        await c.query(
          `insert into public.corrective_actions (site_id, visit_id, category, description, assigned_to) values ($1, $2, 'GENERATOR', 'Fix', $3) returning id`,
          [ids.siteA1, visitId, ids.maintenance],
        )
      ).rows[0].id;
      await c.query(`insert into public.corrective_action_updates (corrective_action_id, note) values ($1, 'Parts ordered')`, [action]);

      await actAs(c, ids.maintenance);
      const count = async (sql: string) => Number((await c.query(sql)).rows[0].n);
      expect(await count(`select count(*) n from public.pm_visits`)).toBe(1);
      expect(await count(`select count(*) n from public.pm_visits where id = '${visitId}'`)).toBe(1);
      expect(await count(`select count(*) n from public.pm_responses where visit_id = '${other}'`)).toBe(0);
      expect(await count(`select count(*) n from public.pm_responses where visit_id = '${visitId}'`)).toBe(1);
      expect(await count(`select count(*) n from public.pm_photos where visit_id = '${visitId}'`)).toBe(1);
      expect(await count(`select count(*) n from public.corrective_action_updates where corrective_action_id = '${action}'`)).toBe(1);

      // Another region's supervisor sees none of it.
      await actAs(c, ids.supervisorB);
      expect(await count(`select count(*) n from public.pm_responses where visit_id = '${visitId}'`)).toBe(0);
      expect(await count(`select count(*) n from public.corrective_action_updates where corrective_action_id = '${action}'`)).toBe(0);
    });
  });
});

describe('profiles and roles', () => {
  it('users cannot change their own role or activation', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.techA);
      const res = await tryQuery(c, `update public.profiles set role = 'super_admin' where id = $1`, [ids.techA]);
      expect(res.error?.code).toBe('42501');
      const ok = await tryQuery(c, `update public.profiles set full_name = 'Tech A' where id = $1`, [ids.techA]);
      expect(ok.rowCount).toBe(1);
    });
  });

  it('technician sees only own profile and their supervisor', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.techA);
      const { rows } = await c.query<{ id: string }>(`select id from public.profiles order by id`);
      expect(rows.map((r) => r.id)).toEqual([ids.supervisorA, ids.techA]);
    });
  });

  it('supervisor sees who they assigned work to; the assignee sees who assigned it', async () => {
    await inTx(async (c) => {
      const visible = async (who: string, id: string) => {
        await actAs(c, who);
        return (await c.query(`select 1 from public.profiles where id = $1`, [id])).rowCount;
      };
      expect(await visible(ids.supervisorA, ids.maintenance)).toBe(0);
      expect(await visible(ids.maintenance, ids.supervisorA)).toBe(0);
      await actAs(c, ids.supervisorA);
      await c.query(
        `insert into public.corrective_actions (site_id, category, description, assigned_to) values ($1, 'GENERATOR', 'Fix it', $2)`,
        [ids.siteA1, ids.maintenance],
      );
      expect(await visible(ids.supervisorA, ids.maintenance)).toBe(1);
      expect(await visible(ids.maintenance, ids.supervisorA)).toBe(1);
      // Other regions still do not see them.
      expect(await visible(ids.supervisorB, ids.maintenance)).toBe(0);
    });
  });

  it('admin_update_user is admin-only and audited', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const denied = await tryQuery(c, `select public.admin_update_user($1, 'super_admin', true)`, [ids.techA]);
      expect(denied.error?.code).toBe('42501');

      await actAs(c, ids.admin);
      await c.query(`select public.admin_update_user($1, 'maintenance', true, null)`, [ids.techA]);
      const { rows } = await c.query(
        `select action, metadata from public.audit_logs where entity_id = $1 order by id desc limit 1`,
        [ids.techA],
      );
      expect(rows[0]).toEqual({
        action: 'USER_ROLE_CHANGED',
        metadata: { from: 'technician', to: 'maintenance' },
      });
      const tech = await c.query(`select is_active from public.technicians where id = $1`, [ids.techA]);
      expect(tech.rows[0].is_active).toBe(false);
    });
  });

  it('admin cannot remove their own super admin access', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const res = await tryQuery(c, `select public.admin_update_user($1, 'viewer', true)`, [ids.admin]);
      expect(res.error?.message).toMatch(/own Super Admin/);
    });
  });
});

describe('audit log and notifications', () => {
  it('record_login writes an audit entry; only admin can read audit logs', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.techA);
      await c.query(`select public.record_login('mobile')`);
      expect((await c.query(`select * from public.audit_logs`)).rowCount).toBe(0);
      const insert = await tryQuery(c, `insert into public.audit_logs (action) values ('FAKE')`);
      expect(insert.error?.code).toBe('42501');

      await actAs(c, ids.admin);
      const { rows } = await c.query(
        `select action, actor_id, metadata from public.audit_logs where action = 'LOGIN' order by id desc limit 1`,
      );
      expect(rows[0]).toEqual({ action: 'LOGIN', actor_id: ids.techA, metadata: { client: 'mobile' } });
    });
  });

  it('notifications are private to the recipient and only read_at is writable', async () => {
    await inTx(async (c) => {
      await c.query(
        `insert into public.notifications (recipient_id, type, title) values ($1, 'PM_SCHEDULED', 'RLS test notification')`,
        [ids.techA],
      );
      const mine = `select * from public.notifications where title = 'RLS test notification'`;
      await actAs(c, ids.techB);
      expect((await c.query(mine)).rowCount).toBe(0);
      await actAs(c, ids.techA);
      expect((await c.query(mine)).rowCount).toBe(1);
      expect((await tryQuery(c, `update public.notifications set read_at = now() where title = 'RLS test notification'`)).rowCount).toBe(1);
      expect((await tryQuery(c, `update public.notifications set title = 'x'`)).error?.code).toBe('42501');
    });
  });
});

describe('storage object policies', () => {
  const insertObject = `insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`;

  it('technician can upload PM photos only under assigned site paths', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.techA);
      const ok = await tryQuery(c, insertObject, ['pm-photos', `${ids.siteA1}/visit/photo.jpg`, ids.techA]);
      expect(ok.error).toBeUndefined();
      const denied = await tryQuery(c, insertObject, ['pm-photos', `${ids.siteB1}/visit/photo.jpg`, ids.techA]);
      expect(denied.error?.message).toMatch(/row-level security/);
      const malformed = await tryQuery(c, insertObject, ['pm-photos', `not-a-uuid/photo.jpg`, ids.techA]);
      expect(malformed.error?.message).toMatch(/row-level security/);
    });
  });

  it('read-only roles cannot upload; photos are readable within scope', async () => {
    await inTx(async (c) => {
      await c.query(insertObject, ['pm-photos', `${ids.siteA1}/v/p.jpg`, ids.techA]);
      await actAs(c, ids.managerA);
      const denied = await tryQuery(c, insertObject, ['pm-photos', `${ids.siteA1}/v/m.jpg`, ids.managerA]);
      expect(denied.error?.message).toMatch(/row-level security/);
      const mine = `select name from storage.objects where name like '${ids.siteA1}/%'`;
      expect((await c.query(mine)).rowCount).toBe(1);
      await actAs(c, ids.supervisorB);
      expect((await c.query(mine)).rowCount).toBe(0);
    });
  });

  it('uploader can retry a photo upload only until the photo is recorded', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const pending = `${ids.siteA1}/${visitId}/pending.jpg`;
      const recorded = `${ids.siteA1}/${visitId}/recorded.jpg`;
      await c.query(insertObject, ['pm-photos', pending, ids.techA]);
      await addPhoto(c, { siteId: ids.siteA1, visitId, itemId: null, path: recorded, ownerId: ids.techA });
      const touch = `update storage.objects set metadata = '{"retry": true}' where name = $1`;
      expect((await tryQuery(c, touch, [pending])).rowCount).toBe(1);
      expect((await tryQuery(c, touch, [recorded])).rowCount).toBe(0);
    });
  });

  it('only super admin may delete photo evidence', async () => {
    await inTx(async (c) => {
      const name = `${ids.siteA1}/v/p.jpg`;
      await c.query(insertObject, ['pm-photos', name, ids.techA]);
      await actAs(c, ids.techA);
      expect((await tryQuery(c, `delete from storage.objects where name = $1`, [name])).rowCount).toBe(0);
      await actAs(c, ids.admin);
      expect((await tryQuery(c, `delete from storage.objects where name = $1`, [name])).rowCount).toBe(1);
    });
  });
});

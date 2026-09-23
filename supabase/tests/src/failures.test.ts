import { afterAll, describe, expect, it } from 'vitest';
import { actAs, activeTemplateId, createVisitAs, getPool, ids, inTx, itemId, relaxRequirements, tryQuery, type Client } from './db';

afterAll(async () => {
  await getPool().end();
});

/** A submitted PM at Test Site A1 by tech.a with the given items answered as failing. */
async function submitWithFailures(c: Client, answers: Record<string, 'YES' | 'NO'>, comment = 'Seen on site'): Promise<string> {
  await relaxRequirements(c);
  const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
  for (const [code, answer] of Object.entries(answers)) {
    await c.query(
      `insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, answer, comment) values ($1, $2, '', $3, $4)`,
      [visitId, await itemId(c, code), answer, comment],
    );
  }
  await c.query(`update public.pm_visits set status = 'SUBMITTED' where id = $1`, [visitId]);
  return visitId;
}

async function notificationsFor(c: Client, userId: string, type?: string) {
  await actAs(c, null);
  const { rows } = await c.query(
    `select type, title, body, entity_type, entity_id from public.notifications
      where recipient_id = $1 and ($2::text is null or type::text = $2) order by created_at`,
    [userId, type ?? null],
  );
  return rows;
}

describe('failures from a submitted PM', () => {
  it('creates one failure per failing answer, with section category and configured severity', async () => {
    await inTx(async (c) => {
      const visitId = await submitWithFailures(c, { gen_radiator: 'NO', gen_burning_oil: 'YES', gen_air_filter_ok: 'YES' });
      await actAs(c, ids.supervisorA);
      const { rows } = await c.query(
        `select f.source, f.category, f.severity, f.status, f.description, f.technician_id, i.code
           from public.failures f join public.pm_checklist_items i on i.id = f.checklist_item_id
          where f.visit_id = $1 order by i.code`,
        [visitId],
      );
      expect(rows.map((r) => r.code)).toEqual(['gen_burning_oil', 'gen_radiator']);
      expect(rows[0]).toMatchObject({ source: 'PM_CHECKLIST', category: 'GENERATOR', severity: 'MEDIUM', status: 'OPEN', technician_id: ids.techA });
      expect(rows[1].description).toMatch(/answered NO: Seen on site$/);

      // The technician sees their failures; the supervisor was told about the submission.
      await actAs(c, ids.techA);
      expect((await c.query(`select 1 from public.failures where visit_id = $1`, [visitId])).rowCount).toBe(2);
      const sup = await notificationsFor(c, ids.supervisorA, 'PM_SUBMITTED');
      expect(sup).toEqual([expect.objectContaining({ entity_type: 'pm_visit', entity_id: visitId, body: '2 failure(s) recorded.' })]);
    });
  });

  it('a resubmission updates failures instead of duplicating, and drops ones fixed before anyone acted', async () => {
    await inTx(async (c) => {
      const visitId = await submitWithFailures(c, { gen_radiator: 'NO', gen_solenoid: 'NO' });
      await actAs(c, ids.supervisorA);
      const solenoid = (await c.query(`select id from public.failures where visit_id = $1 and checklist_item_id = $2`, [visitId, await itemId(c, 'gen_solenoid')])).rows[0].id;
      await c.query(`insert into public.corrective_actions (failure_id, site_id, category, description) values ($1, $2, 'GENERATOR', 'Replace solenoid')`, [solenoid, ids.siteA1]);
      await c.query(`update public.pm_visits set status = 'REJECTED', review_comments = 'Check the radiator again' where id = $1`, [visitId]);
      expect(await notificationsFor(c, ids.techA, 'PM_REJECTED')).toEqual([expect.objectContaining({ body: 'Check the radiator again' })]);

      // Technician fixes both answers and resubmits.
      await actAs(c, ids.techA);
      await c.query(`update public.pm_responses set answer = 'YES', comment = null where visit_id = $1`, [visitId]);
      await c.query(`update public.pm_visits set status = 'SUBMITTED' where id = $1`, [visitId]);
      await actAs(c, ids.supervisorA);
      const left = await c.query(`select id, status from public.failures where visit_id = $1`, [visitId]);
      // The radiator failure (nobody acted) is gone; the solenoid one has a corrective action and stays.
      expect(left.rows).toEqual([{ id: solenoid, status: 'OPEN' }]);

      // Reporting it again re-creates exactly one.
      await c.query(`update public.pm_visits set status = 'REJECTED', review_comments = 'x' where id = $1`, [visitId]);
      await actAs(c, ids.techA);
      await c.query(`update public.pm_responses set answer = 'NO', comment = 'Still leaking' where visit_id = $1`, [visitId]);
      await c.query(`update public.pm_visits set status = 'SUBMITTED' where id = $1`, [visitId]);
      await actAs(c, null);
      expect((await c.query(`select count(*)::int as n from public.failures where visit_id = $1`, [visitId])).rows[0].n).toBe(2);
    });
  });

  it('ignores failing answers in sections marked not applicable', async () => {
    await inTx(async (c) => {
      await relaxRequirements(c);
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await c.query(`insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, answer) values ($1, $2, '', 'NO')`, [visitId, await itemId(c, 'gen_radiator')]);
      await c.query(`update public.pm_visits set not_applicable_sections = '{GENERATOR}', status = 'SUBMITTED' where id = $1`, [visitId]);
      await actAs(c, null);
      expect((await c.query(`select 1 from public.failures where visit_id = $1`, [visitId])).rowCount).toBe(0);
    });
  });

  it('critical failures alert the site supervisor and the regional managers', async () => {
    await inTx(async (c) => {
      await actAs(c, null);
      await c.query(`update public.pm_checklist_items set failure_severity = 'CRITICAL' where id = $1`, [await itemId(c, 'gen_radiator')]);
      await submitWithFailures(c, { gen_radiator: 'NO', gen_solenoid: 'NO' });
      for (const who of [ids.supervisorA, ids.managerA]) {
        const n = await notificationsFor(c, who, 'CRITICAL_FAILURE');
        expect(n).toHaveLength(1);
        expect(n[0].title).toBe('Critical failure at T-A1 Test Site A1');
      }
      expect(await notificationsFor(c, ids.supervisorB, 'CRITICAL_FAILURE')).toEqual([]);
    });
  });
});

describe('failure rules', () => {
  it('checklist failures come only from submission; technicians may report manual ones on their sites', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.techA);
      const fake = await tryQuery(c, `insert into public.failures (source, site_id, category, description, visit_id, checklist_item_id)
                                      values ('PM_CHECKLIST', $1, 'GENERATOR', 'x', null, null)`, [ids.siteA1]);
      expect(fake.error).toBeDefined();
      const manual = await tryQuery(c, `insert into public.failures (source, site_id, category, description, severity, technician_id)
                                        values ('MANUAL', $1, 'DC_SYSTEM', 'Rectifier alarm', 'HIGH', $2) returning technician_id, status`, [ids.siteA1, ids.techA]);
      expect(manual.error).toBeUndefined();
      expect(manual.rows[0]).toEqual({ technician_id: ids.techA, status: 'OPEN' });
      const elsewhere = await tryQuery(c, `insert into public.failures (source, site_id, category, description, technician_id)
                                           values ('MANUAL', $1, 'DC_SYSTEM', 'x', $2)`, [ids.siteB1, ids.techA]);
      expect(elsewhere.error?.message).toMatch(/row-level security/);
    });
  });

  it('supervisors close with a note (not while actions are open) and can reopen; other statuses follow actions', async () => {
    await inTx(async (c) => {
      const visitId = await submitWithFailures(c, { gen_radiator: 'NO' });
      await actAs(c, ids.supervisorA);
      const f = (await c.query(`select id from public.failures where visit_id = $1`, [visitId])).rows[0].id;
      expect((await tryQuery(c, `update public.failures set status = 'CLOSED' where id = $1`, [f])).error?.message).toMatch(/note is required/);
      expect((await tryQuery(c, `update public.failures set status = 'RESOLVED' where id = $1`, [f])).error?.message).toMatch(/follows its corrective actions/);
      expect((await tryQuery(c, `update public.failures set site_id = $2 where id = $1`, [f, ids.siteB1])).error).toBeDefined();
      const ca = await c.query(`insert into public.corrective_actions (failure_id, site_id, category, description) values ($1, $2, 'GENERATOR', 'Fix') returning id`, [f, ids.siteA1]);
      expect((await tryQuery(c, `update public.failures set status = 'CLOSED', resolution_note = 'dup' where id = $1`, [f])).error?.message).toMatch(/in progress/);
      await c.query(`update public.corrective_actions set status = 'CLOSED' where id = $1`, [ca.rows[0].id]);
      expect((await c.query(`select status from public.failures where id = $1`, [f])).rows[0].status).toBe('CLOSED');
      await c.query(`update public.failures set status = 'OPEN' where id = $1`, [f]);
      const reopened = await c.query(`select status, closed_at from public.failures where id = $1`, [f]);
      expect(reopened.rows[0]).toEqual({ status: 'OPEN', closed_at: null });
      // Its only action is closed, so it can now be closed directly with a note.
      const closed = await c.query(`update public.failures set status = 'CLOSED', resolution_note = 'Duplicate of FL-1' where id = $1 returning status, closed_at`, [f]);
      expect(closed.rows[0].status).toBe('CLOSED');
      expect(closed.rows[0].closed_at).not.toBeNull();
      // The technician cannot change failures (RLS: no matching row to update).
      await actAs(c, ids.techA);
      const techUpdate = await tryQuery(c, `update public.failures set severity = 'LOW' where id = $1 returning id`, [f]);
      expect(techUpdate.error).toBeUndefined();
      expect(techUpdate.rowCount).toBe(0);
    });
  });
});

describe('corrective action workflow', () => {
  it('runs assign → in progress → completed → returned → completed → verified → closed, keeping the failure in step', async () => {
    await inTx(async (c) => {
      const visitId = await submitWithFailures(c, { gen_radiator: 'NO' });
      await actAs(c, ids.supervisorA);
      const f = (await c.query(`select id from public.failures where visit_id = $1`, [visitId])).rows[0].id;
      const status = async () => (await c.query(`select status from public.failures where id = $1`, [f])).rows[0].status;

      // Site, visit and category come from the failure (whatever the client sends).
      const ca = (
        await c.query(
          `insert into public.corrective_actions (failure_id, site_id, category, description, priority, assigned_to, due_date)
           values ($1, $2, 'SOLAR', 'Replace radiator hose', 'HIGH', $3, current_date + 7)
           returning id, site_id, category, visit_id, status, assigned_by`,
          [f, ids.siteB1, ids.techA],
        )
      ).rows[0];
      expect(ca).toMatchObject({ site_id: ids.siteA1, category: 'GENERATOR', visit_id: visitId, status: 'ASSIGNED', assigned_by: ids.supervisorA });
      expect(await status()).toBe('ASSIGNED');
      expect(await notificationsFor(c, ids.techA, 'CORRECTIVE_ACTION_ASSIGNED')).toEqual([expect.objectContaining({ entity_id: ca.id })]);

      await actAs(c, ids.techA);
      await c.query(`update public.corrective_actions set status = 'IN_PROGRESS' where id = $1`, [ca.id]);
      expect(await status()).toBe('IN_PROGRESS');
      expect((await tryQuery(c, `update public.corrective_actions set status = 'COMPLETED' where id = $1`, [ca.id])).error?.message).toMatch(/resolution note/);
      await c.query(`update public.corrective_actions set status = 'COMPLETED', resolution = 'Hose replaced' where id = $1`, [ca.id]);
      expect(await status()).toBe('RESOLVED');
      expect(await notificationsFor(c, ids.supervisorA, 'CORRECTIVE_ACTION_COMPLETED')).toHaveLength(1);
      await actAs(c, ids.techA);
      expect((await tryQuery(c, `update public.corrective_actions set status = 'VERIFIED' where id = $1`, [ca.id])).error?.code).toBe('42501');
      expect((await tryQuery(c, `select public.return_corrective_action($1, 'nope')`, [ca.id])).error).toBeDefined();

      // Supervisor returns it with a note.
      await actAs(c, ids.supervisorA);
      expect((await tryQuery(c, `select public.return_corrective_action($1, '  ')`, [ca.id])).error?.message).toMatch(/Explain/);
      await c.query(`select public.return_corrective_action($1, 'Clamp still loose')`, [ca.id]);
      expect(await status()).toBe('IN_PROGRESS');
      const returned = await notificationsFor(c, ids.techA, 'CORRECTIVE_ACTION_ASSIGNED');
      expect(returned.at(-1)).toMatchObject({ title: 'Corrective action returned: T-A1 Test Site A1' });

      await actAs(c, ids.techA);
      await c.query(`update public.corrective_actions set status = 'COMPLETED', resolution = 'Hose and clamp replaced' where id = $1`, [ca.id]);
      await actAs(c, ids.supervisorA);
      await c.query(`update public.corrective_actions set status = 'VERIFIED' where id = $1`, [ca.id]);
      expect(await status()).toBe('VERIFIED');
      await c.query(`update public.corrective_actions set status = 'CLOSED' where id = $1`, [ca.id]);
      expect(await status()).toBe('CLOSED');

      const timeline = await c.query(
        `select from_status, to_status, note from public.corrective_action_updates where corrective_action_id = $1 order by created_at, to_status nulls first`,
        [ca.id],
      );
      expect(timeline.rows.map((r) => r.note ?? `${r.from_status}→${r.to_status}`)).toEqual(
        expect.arrayContaining(['ASSIGNED→IN_PROGRESS', 'IN_PROGRESS→COMPLETED', 'COMPLETED→IN_PROGRESS', 'Clamp still loose', 'COMPLETED→VERIFIED', 'VERIFIED→CLOSED']),
      );
    });
  });

  it('assignees must be active field users or supervisors; the assignee list follows the site', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const bad = await tryQuery(c, `insert into public.corrective_actions (site_id, category, description, assigned_to) values ($1, 'DC_SYSTEM', 'x', $2)`, [ids.siteA1, ids.viewer]);
      expect(bad.error?.message).toMatch(/can only be assigned/);
      const inactive = await tryQuery(c, `insert into public.corrective_actions (site_id, category, description, assigned_to) values ($1, 'DC_SYSTEM', 'x', $2)`, [ids.siteA1, ids.inactiveTech]);
      expect(inactive.error?.message).toMatch(/can only be assigned/);
      const empty = await tryQuery(c, `insert into public.corrective_actions (site_id, category, description) values ($1, 'DC_SYSTEM', '  ')`, [ids.siteA1]);
      expect(empty.error?.message).toMatch(/Describe/);

      const list = await c.query(`select id, role from public.corrective_action_assignees($1)`, [ids.siteA1]);
      expect(list.rows.map((r) => r.id).sort()).toEqual([ids.techA, ids.maintenance, ids.supervisorA].sort());
      await actAs(c, ids.techA);
      expect((await c.query(`select * from public.corrective_action_assignees($1)`, [ids.siteA1])).rowCount).toBe(0);
    });
  });

  it('maintenance users see and work only the actions assigned to them', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const ca = (await c.query(`insert into public.corrective_actions (site_id, category, description, assigned_to) values ($1, 'EARTHING', 'Re-bond earth bar', $2) returning id`, [ids.siteA1, ids.maintenance])).rows[0].id;
      await c.query(`insert into public.corrective_actions (site_id, category, description) values ($1, 'EARTHING', 'Unassigned')`, [ids.siteA1]);
      await actAs(c, ids.maintenance);
      expect((await c.query(`select id from public.corrective_actions`)).rows.map((r) => r.id)).toEqual([ca]);
      await c.query(`update public.corrective_actions set status = 'IN_PROGRESS' where id = $1`, [ca]);
      expect((await tryQuery(c, `update public.corrective_actions set due_date = current_date where id = $1`, [ca])).error?.code).toBe('42501');
      const note = await tryQuery(c, `insert into public.corrective_action_updates (corrective_action_id, note) values ($1, 'Parts ordered')`, [ca]);
      expect(note.error).toBeUndefined();
    });
  });
});

describe('notifications', () => {
  it('schedules, assignments and overdue PMs notify the right people once', async () => {
    await inTx(async (c) => {
      const templateId = await activeTemplateId(c);
      await actAs(c, ids.supervisorA);
      const s = (
        await c.query(
          `insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date, frequency)
           values ($1, $2, $3, current_date - 10, current_date - 1, 'MONTHLY') returning id`,
          [ids.siteA1, templateId, ids.techA],
        )
      ).rows[0].id;
      expect(await notificationsFor(c, ids.techA, 'PM_SCHEDULED')).toEqual([expect.objectContaining({ entity_id: s, entity_type: 'pm_schedule' })]);
      // Nobody is notified of their own actions.
      expect(await notificationsFor(c, ids.supervisorA, 'PM_SCHEDULED')).toEqual([]);

      await actAs(c, null);
      await c.query(`select public.mark_overdue_schedules()`);
      await c.query(`update public.pm_schedules set status = 'SCHEDULED' where id = $1`, [s]);
      await c.query(`select public.mark_overdue_schedules()`);
      expect(await notificationsFor(c, ids.techA, 'PM_OVERDUE')).toHaveLength(1);
      expect(await notificationsFor(c, ids.supervisorA, 'PM_OVERDUE')).toHaveLength(1);

      // Fixture assignments produced SITE_ASSIGNED notifications for technicians.
      expect(await notificationsFor(c, ids.techA, 'SITE_ASSIGNED')).toEqual([expect.objectContaining({ entity_id: ids.siteA1 })]);
    });
  });

  it('daily reminders follow the notification settings and are sent once', async () => {
    await inTx(async (c) => {
      const templateId = await activeTemplateId(c);
      await actAs(c, ids.supervisorA);
      await c.query(
        `insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date, frequency)
         values ($1, $2, $3, current_date, current_date + 2, 'MONTHLY')`,
        [ids.siteA1, templateId, ids.techA],
      );
      await c.query(`insert into public.corrective_actions (site_id, category, description, assigned_to, due_date) values ($1, 'DC_SYSTEM', 'Late job', $2, current_date - 1)`, [ids.siteA1, ids.techA]);

      await actAs(c, ids.admin);
      await c.query(`update public.system_settings set value = '{"pm_due_reminder_days": null, "corrective_action_overdue_enabled": false}' where key = 'notifications'`);
      await c.query(`select public.run_daily_notifications()`);
      expect(await notificationsFor(c, ids.techA, 'PM_DUE')).toEqual([]);
      expect(await notificationsFor(c, ids.techA, 'CORRECTIVE_ACTION_OVERDUE')).toEqual([]);

      await actAs(c, ids.admin);
      await c.query(`update public.system_settings set value = '{"pm_due_reminder_days": 3, "corrective_action_overdue_enabled": true}' where key = 'notifications'`);
      await c.query(`select public.run_daily_notifications()`);
      await c.query(`select public.run_daily_notifications()`);
      expect(await notificationsFor(c, ids.techA, 'PM_DUE')).toHaveLength(1);
      expect(await notificationsFor(c, ids.techA, 'CORRECTIVE_ACTION_OVERDUE')).toHaveLength(1);
      expect(await notificationsFor(c, ids.supervisorA, 'CORRECTIVE_ACTION_OVERDUE')).toHaveLength(1);

      await actAs(c, ids.techA);
      expect((await tryQuery(c, `select public.run_daily_notifications()`)).error?.code).toBe('42501');
    });
  });

  it('recipients can mark all read; inactive users are not notified', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.techA);
      const n = (await c.query(`select public.mark_all_notifications_read() as n`)).rows[0].n;
      expect(n).toBeGreaterThanOrEqual(1);
      expect((await c.query(`select 1 from public.notifications where read_at is null`)).rowCount).toBe(0);
      await actAs(c, null);
      await c.query(`select private.notify(array[$1::uuid], 'PM_DUE', 't', null, null, null)`, [ids.inactiveTech]);
      expect(await notificationsFor(c, ids.inactiveTech, 'PM_DUE')).toEqual([]);
    });
  });
});

describe('push tokens', () => {
  it('registers Expo tokens for the signed-in user only', async () => {
    await inTx(async (c) => {
      const token = 'ExponentPushToken[abc123_XYZ]';
      await actAs(c, ids.techA);
      expect((await tryQuery(c, `select public.register_push_token('not-a-token', 'android')`)).error?.message).toMatch(/Expo push token/);
      await c.query(`select public.register_push_token($1, 'android')`, [token]);
      expect((await c.query(`select profile_id from public.push_tokens`)).rows).toEqual([{ profile_id: ids.techA }]);
      expect((await tryQuery(c, `insert into public.push_tokens (token, profile_id, platform) values ('ExponentPushToken[x]', $1, 'ios')`, [ids.techA])).error?.code).toBe('42501');

      // Same phone, different account: the token moves.
      await actAs(c, ids.techB);
      await c.query(`select public.register_push_token($1, 'android')`, [token]);
      await actAs(c, ids.techA);
      expect((await c.query(`select 1 from public.push_tokens`)).rowCount).toBe(0);
      await actAs(c, 'anon');
      expect((await tryQuery(c, `select public.register_push_token($1, 'android')`, [token])).error?.code).toBe('42501');
    });
  });
});

describe('offline download (Phase 6 additions)', () => {
  it('includes the caller’s corrective actions with timeline, and recent notifications', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const ca = (await c.query(`insert into public.corrective_actions (site_id, category, description, assigned_to) values ($1, 'DC_SYSTEM', 'Replace fuse', $2) returning id`, [ids.siteA1, ids.techA])).rows[0].id;
      await c.query(`insert into public.corrective_action_updates (corrective_action_id, note) values ($1, 'Fuse type 63A')`, [ca]);
      await actAs(c, ids.techA);
      const b = (await c.query(`select public.mobile_sync_bundle() as b`)).rows[0].b;
      expect(b.actions).toHaveLength(1);
      expect(b.actions[0]).toMatchObject({ id: ca, site_code: 'T-A1', status: 'ASSIGNED' });
      expect(b.actions[0].updates.map((u: { note: string | null }) => u.note)).toContain('Fuse type 63A');
      expect(b.notifications.map((n: { type: string }) => n.type)).toContain('CORRECTIVE_ACTION_ASSIGNED');
      await actAs(c, ids.techB);
      expect((await c.query(`select public.mobile_sync_bundle() as b`)).rows[0].b.actions).toEqual([]);
    });
  });
});

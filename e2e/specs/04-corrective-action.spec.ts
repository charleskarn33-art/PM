import { expect, test } from '@playwright/test';
import { signInAs } from '../support/auth';
import { ids, one, submitPmAsTechnician } from '../support/db';

test.describe('failure → corrective action → verification', () => {
  test('supervisor assigns the work, maintenance completes it, supervisor verifies; the failure follows', async ({ page }) => {
    const visitId = await submitPmAsTechnician(['gen_solenoid']);
    const failure = await one<{ id: string; failure_number: string }>(`select id, failure_number from public.failures where visit_id = $1`, [visitId]);

    await signInAs(page.context(), 'supervisor');
    await page.goto('/failures');
    await page.getByRole('link', { name: failure.failure_number }).click();
    await expect(page).toHaveURL(`/failures/${failure.id}`);
    await page.getByLabel('Work to be done').fill('Reconnect and test the solenoid.');
    await page.getByLabel('Assign to').selectOption(ids.maintenance);
    await page.getByLabel('Due date').fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Create corrective action' }).click();
    await expect(page.getByText(/Corrective action created and assigned to/)).toBeVisible();
    const actionUrl = page.url().replace(/\?.*$/, '');
    expect((await one<{ status: string }>(`select status from public.failures where id = $1`, [failure.id])).status).toBe('ASSIGNED');

    await signInAs(page.context(), 'maintenance');
    await page.goto('/corrective-actions');
    await page.goto(actionUrl);
    await page.getByRole('button', { name: 'Start work' }).click();
    await page.getByLabel('What was done').fill('Solenoid wire re-terminated; generator start tested three times.');
    await page.getByRole('button', { name: 'Mark completed' }).click();
    await expect(page).toHaveURL(/done=COMPLETED/);
    expect((await one<{ status: string }>(`select status from public.failures where id = $1`, [failure.id])).status).toBe('RESOLVED');

    await signInAs(page.context(), 'supervisor');
    await page.goto(actionUrl);
    await page.getByRole('button', { name: 'Verify work' }).click();
    await expect(page).toHaveURL(/done=VERIFIED/);
    expect((await one<{ status: string }>(`select status from public.failures where id = $1`, [failure.id])).status).toBe('VERIFIED');
  });

  test('maintenance cannot open work assigned to someone else', async ({ page }) => {
    const visitId = await submitPmAsTechnician(['gen_radiator']);
    const failure = await one<{ id: string }>(`select id from public.failures where visit_id = $1`, [visitId]);
    const action = await one<{ id: string }>(
      `insert into public.corrective_actions (failure_id, site_id, category, description, assigned_to) values ($1, $2, 'GENERATOR', 'Tech work', $3) returning id`,
      [failure.id, ids.siteA1, ids.techA],
    );
    await signInAs(page.context(), 'maintenance');
    expect((await page.goto(`/corrective-actions/${action.id}`))?.status()).toBe(404);
  });
});

import { expect, test } from '@playwright/test';
import { signInAs } from '../support/auth';
import { asUser, db, ids, one, submitPmAsTechnician } from '../support/db';

test.describe('PM review', () => {
  test('supervisor reviews a submitted PM: sees its failure, returns it, then approves the resubmission', async ({ page }) => {
    const visitId = await submitPmAsTechnician(['gen_radiator']);
    const failure = await one<{ failure_number: string }>(`select failure_number from public.failures where visit_id = $1`, [visitId]);

    await signInAs(page.context(), 'supervisor');
    await page.goto('/visits');
    const row = page.getByRole('row').filter({ hasText: 'T-A1' }).filter({ hasText: 'Submitted' }).first();
    await expect(row).toBeVisible();
    await page.goto(`/visits/${visitId}`);
    await expect(page.getByRole('link', { name: failure.failure_number }).locator('..')).toContainText('Check Radiator');
    await expect(page.getByRole('link', { name: failure.failure_number })).toBeVisible();

    // Returning a PM needs a reason.
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText('Explain what the technician must correct')).toBeVisible();
    await page.getByLabel('Review comments').fill('Radiator photo missing; add one and resubmit.');
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Rejected by supervisor.a' })).toContainText('Radiator photo missing');
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    expect((await one<{ status: string }>(`select status from public.pm_visits where id = $1`, [visitId])).status).toBe('REJECTED');
    const { rows } = await db().query(`select 1 from public.notifications where recipient_id = $1 and entity_id = $2`, [ids.techA, visitId]);
    expect(rows.length).toBeGreaterThan(0);

    // The technician corrects and resubmits (done on the phone).
    await asUser(ids.techA, (c) => c.query(`update public.pm_visits set status = 'SUBMITTED' where id = $1`, [visitId]));

    await page.reload();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Approved by supervisor.a' })).toBeVisible();
    expect((await one<{ status: string }>(`select status from public.pm_visits where id = $1`, [visitId])).status).toBe('APPROVED');
  });

  test('a supervisor of another region cannot see or review the PM', async ({ page }) => {
    const visitId = await submitPmAsTechnician();
    await signInAs(page.context(), 'supervisorB');
    const res = await page.goto(`/visits/${visitId}`);
    expect(res?.status()).toBe(404);
    expect((await page.request.get(`/visits/${visitId}/report`)).status()).toBe(404);
  });

  test('the PM report downloads as a PDF', async ({ page }) => {
    const visitId = await submitPmAsTechnician(['gen_radiator']);
    await signInAs(page.context(), 'supervisor');
    await page.goto(`/visits/${visitId}`);
    const href = await page.getByRole('link', { name: 'PDF report' }).getAttribute('href');
    const res = await page.request.get(`${href}?download=1`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename="PM-T-A1-Test-Site-A1-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

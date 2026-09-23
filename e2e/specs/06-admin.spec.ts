import { expect, test } from '@playwright/test';
import { signInAs } from '../support/auth';
import { ids, one } from '../support/db';

test.describe('administration', () => {
  test('Super Admin adds a site; it appears in the register and the audit log', async ({ page }) => {
    await signInAs(page.context(), 'admin');
    await page.goto('/sites/new');
    await page.getByLabel('Site ID').fill('E2E-100');
    await page.getByLabel('Site name').fill('E2E Hilltop');
    await page.getByLabel('Region').selectOption(ids.regionA);
    await page.getByLabel('Latitude').fill('6.3');
    await page.getByLabel('Longitude').fill('-10.8');
    await page.getByRole('button', { name: /create site|save/i }).click();
    await expect(page).toHaveURL(/\/sites\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Hilltop');

    await page.goto('/sites?q=E2E-100');
    await expect(page.getByRole('row').filter({ hasText: 'E2E-100' })).toHaveCount(1);
    const site = await one<{ id: string }>(`select id from public.sites where site_code = 'E2E-100'`);
    const audit = await one<{ n: number }>(`select count(*)::int as n from public.audit_logs where entity_id = $1`, [site.id]);
    expect(audit.n).toBeGreaterThan(0);
  });

  test('site codes stay unique', async ({ page }) => {
    await signInAs(page.context(), 'admin');
    await page.goto('/sites/new');
    await page.getByLabel('Site ID').fill('T-A1');
    await page.getByLabel('Site name').fill('Duplicate');
    await page.getByLabel('Region').selectOption(ids.regionA);
    await page.getByRole('button', { name: /create site|save/i }).click();
    await expect(page.getByText(/already/i)).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { signInAs } from '../support/auth';
import { submitPmAsTechnician } from '../support/db';

test.describe('reports and audit log', () => {
  test('a filtered list exports exactly that list as an Excel-ready CSV', async ({ page }) => {
    await submitPmAsTechnician();
    await signInAs(page.context(), 'supervisor');
    await page.goto('/visits?status=SUBMITTED');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^pm-visits-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = (await (await file.createReadStream()).toArray()).map(String).join('');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toMatch(/^Site ID,Site Name,Technician,/);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((l) => l.includes('SUBMITTED') || l.includes('Submitted'))).toBe(true);
  });

  test('the reports page lists PM reports and analytics exports', async ({ page }) => {
    await signInAs(page.context(), 'supervisor');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    expect(await page.getByRole('link', { name: 'PDF' }).count()).toBeGreaterThan(0);
    const res = await page.request.get('/analytics/export?dataset=compliance&group=region&period=12m');
    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(/^﻿Region,/);
  });

  test('the Super Admin sees who generated each report and what changed', async ({ page }) => {
    await signInAs(page.context(), 'admin');
    await page.goto('/admin/audit?action=REPORT_GENERATED');
    await expect(page.getByRole('row').filter({ hasText: 'supervisor.a' }).filter({ hasText: 'PM visits CSV' }).first()).toBeVisible();
    // The PM returned in the review spec: who did it, from which status to which.
    await page.goto('/admin/audit?action=PM_REJECTED');
    await expect(page.getByRole('row').filter({ hasText: 'supervisor.a' }).filter({ hasText: 'SUBMITTED → REJECTED' }).first()).toBeVisible();
  });
});

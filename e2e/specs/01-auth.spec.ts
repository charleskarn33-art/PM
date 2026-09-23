import { expect, test } from '@playwright/test';
import { signInAs, users } from '../support/auth';
import { db } from '../support/db';
import { E2E } from '../support/env';

test.describe('sign-in', () => {
  test('a signed-out visitor is sent to sign in and returned to the page they asked for', async ({ page }) => {
    await page.goto('/visits?status=ALL');
    await expect(page).toHaveURL(/\/login\?next=%2Fvisits/);
    await page.getByLabel('Email address').fill(users.supervisor.email);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();

    await page.getByLabel('Password').fill(E2E.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/visits$/);
    await expect(page.getByRole('heading', { name: 'PM Visits & Review' })).toBeVisible();

    const { rows } = await db().query(`select 1 from public.audit_logs where action = 'LOGIN' and actor_id = $1`, [users.supervisor.id]);
    expect(rows.length).toBeGreaterThan(0);
  });

  test('a crafted return address cannot send the user to another site', async ({ page }) => {
    for (const next of ['https://evil.example/', '//evil.example/', '/\t/evil.example/', '/\\evil.example/']) {
      await page.context().clearCookies();
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel('Email address').fill(users.viewer.email);
      await page.getByLabel('Password').fill(E2E.password);
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).toHaveURL(`${E2E.webUrl}/dashboard`);
    }
  });

  test('signing out ends the session', async ({ page }) => {
    await signInAs(page.context(), 'viewer');
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a deactivated account cannot use the portal', async ({ page }) => {
    await signInAs(page.context(), 'inactive');
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/account-inactive/);
  });
});

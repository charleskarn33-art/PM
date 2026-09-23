import { expect, test, type Page } from '@playwright/test';
import { signInAs, type UserKey } from '../support/auth';

const menu = async (page: Page) => (await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts()).map((t) => t.trim()).filter(Boolean);

const EXPECTED_MENU: Partial<Record<UserKey, string[]>> = {
  technician: ['Dashboard', 'Sites', 'Corrective Actions', 'Notifications', 'My Profile'],
  maintenance: ['Dashboard', 'Sites', 'Corrective Actions', 'Notifications', 'My Profile'],
  supervisor: ['Dashboard', 'Sites', 'Technicians', 'PM Schedule', 'PM Visits & Review', 'Failures', 'Corrective Actions', 'Analytics', 'Reports', 'Notifications', 'My Profile'],
  admin: [
    'Dashboard', 'Sites', 'Technicians', 'Supervisors', 'PM Schedule', 'PM Visits & Review', 'Failures', 'Corrective Actions', 'Analytics', 'Reports',
    'Users', 'Organization', 'PM Templates', 'Settings', 'Audit Log', 'Notifications', 'My Profile',
  ],
};

/** Pages each role must not reach by typing the address (the menu hides them too). */
const FORBIDDEN: Partial<Record<UserKey, string[]>> = {
  technician: ['/visits', '/failures', '/schedule', '/analytics', '/reports', '/admin/users', '/admin/audit', '/visits/export'],
  maintenance: ['/visits', '/failures', '/reports', '/admin/settings'],
  supervisor: ['/admin/users', '/admin/organization', '/admin/templates', '/admin/settings', '/admin/audit', '/admin/audit/export'],
  manager: ['/admin/users', '/admin/audit', '/failures/new', '/sites/new'],
  viewer: ['/admin/users', '/admin/settings', '/admin/audit', '/failures/new', '/sites/new'],
};

test.describe('role-based access', () => {
  for (const [role, items] of Object.entries(EXPECTED_MENU)) {
    test(`${role} sees exactly their menu`, async ({ page }) => {
      await signInAs(page.context(), role as UserKey);
      await page.goto('/dashboard');
      expect(await menu(page)).toEqual(items);
    });
  }

  for (const [role, paths] of Object.entries(FORBIDDEN)) {
    test(`${role} cannot open pages outside their role`, async ({ page }) => {
      await signInAs(page.context(), role as UserKey);
      for (const path of paths) {
        const res = await page.goto(path);
        expect(res?.status(), path).toBe(404);
      }
    });
  }

  test('read-only roles get no editing controls', async ({ page }) => {
    await signInAs(page.context(), 'viewer');
    await page.goto('/failures');
    await expect(page.getByRole('heading', { level: 1, name: 'Failures' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Report failure' })).toHaveCount(0);
    await page.goto('/sites');
    await expect(page.getByRole('link', { name: /add site/i })).toHaveCount(0);
  });
});

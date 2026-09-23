import { expect, test } from '@playwright/test';
import { signInAs } from '../support/auth';

const PAGES = [
  '/dashboard', '/sites', '/technicians', '/supervisors', '/schedule', '/visits', '/failures', '/corrective-actions',
  '/analytics', '/analytics?tab=equipment', '/reports', '/admin/users', '/admin/organization', '/admin/templates', '/admin/settings', '/admin/audit', '/notifications', '/profile',
];

test.describe('browser security', () => {
  test('every response carries the security headers and a per-request script nonce', async ({ page }) => {
    const first = await page.request.get('/login');
    const second = await page.request.get('/login');
    for (const res of [first, second]) {
      const h = res.headers();
      expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
      expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['strict-transport-security']).toContain('max-age=');
      expect(h['x-powered-by']).toBeUndefined();
    }
    const nonce = (h: string) => h.match(/'nonce-([^']+)'/)![1];
    expect(nonce(first.headers()['content-security-policy']!)).not.toBe(nonce(second.headers()['content-security-policy']!));
  });

  test('every page works under the Content-Security-Policy, without script errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`${page.url()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${page.url()}: ${e.message}`));
    await signInAs(page.context(), 'admin');
    for (const path of PAGES) {
      const res = await page.goto(path, { waitUntil: 'networkidle' });
      expect(res?.status(), path).toBe(200);
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    }
    // A script blocked by the policy is reported as a console error, collected above.
    expect(problems).toEqual([]);

    // React is running (hydrated): the phone-width menu opens on click.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
  });
});

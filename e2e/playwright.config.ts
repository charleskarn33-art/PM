import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { E2E, gatewayUrl } from './support/env';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// E2E_SKIP_BUILD=1 reuses the last e2e build (the build bakes in the gateway URL).
const build = process.env.E2E_SKIP_BUILD ? '' : 'pnpm --filter @ipt/web build && ';

export default defineConfig({
  testDir: './specs',
  // Specs share one database and some change it: run them one at a time, in file order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './support/global-setup.ts',
  use: {
    baseURL: E2E.webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `${build}pnpm --filter @ipt/web exec next start -p ${new URL(E2E.webUrl).port}`,
    cwd: repoRoot,
    url: `${E2E.webUrl}/login`,
    timeout: 600_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: gatewayUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'e2e-publishable-key',
      SITE_URL: E2E.webUrl,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});

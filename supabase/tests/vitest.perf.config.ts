import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// A separate database and PostgREST port, so the benchmark never touches the test database.
process.env.TEST_DATABASE_NAME ??= 'ipt_pm_perf';
process.env.TEST_POSTGREST_PORT ??= '3996';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../apps/web/src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    globalSetup: ['./perf/perf-setup.ts'],
    include: ['perf/**/*.perf.ts'],
    testTimeout: 300_000,
    hookTimeout: 1_800_000,
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // API tests import the web app's real query modules.
      '@': fileURLToPath(new URL('../../apps/web/src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    globalSetup: ['./src/global-setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

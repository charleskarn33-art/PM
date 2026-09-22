import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/global-setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

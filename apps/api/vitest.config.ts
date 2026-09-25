import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Local runs read the repository's .env (never committed); CI sets variables directly.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

// SWC keeps decorator metadata, which Nest's dependency injection relies on.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    // Integration files share one test database; run files one at a time.
    fileParallelism: false,
    projects: [
      { plugins, test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' } },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});

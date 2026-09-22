import { defineConfig } from 'vitest/config';

// Unit tests cover platform-independent logic only (no native modules).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});

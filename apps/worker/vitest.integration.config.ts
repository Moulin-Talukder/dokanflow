import { defineConfig } from 'vitest/config';

// Runs against a real Redis (docker compose up, or the CI service).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

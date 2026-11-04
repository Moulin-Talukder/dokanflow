import { defineConfig } from 'vitest/config';

// Integration tests need a real Postgres (docker compose up, or the CI service)
// with migrations applied. They are never mocked.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

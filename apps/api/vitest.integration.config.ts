import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests boot the real app against real Postgres and Redis.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not Vite's default transformer) emits the decorator metadata Nest's DI relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
  },
});

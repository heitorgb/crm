import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts', 'test/**/*.integration-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

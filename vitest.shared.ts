import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { LOG_LEVEL: 'silent' },
    // config/** covers colocated tests next to non-src config modules (e.g.
    // packages/infra/config/schema.test.ts) — without it those files are
    // silently never run by `vitest run`.
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts', 'config/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
    clearMocks: true,
    restoreMocks: true,
  },
});

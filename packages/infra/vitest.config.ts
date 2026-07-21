import { mergeConfig, defineConfig } from 'vitest/config';
import sharedConfig from '../../vitest.shared.ts';

// This package mixes CPU-heavy CDK/esbuild bundling (api-stack.test.ts,
// web-stack.test.ts) with real-subprocess timing-sensitive tests
// (test/entrypoint.test.ts, which spawns bash against tight default
// timeouts). Running test files in parallel lets the bundling work starve
// the subprocess tests of CPU and trip their timeouts under load, so this
// package runs its test files sequentially instead of loosening any
// individual test's timeout.
export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      fileParallelism: false,
    },
  }),
);

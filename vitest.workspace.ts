import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/domain',
  'packages/data',
  'packages/services',
  'packages/api',
  'packages/runner',
  'packages/cli',
  'packages/infra',
  'tests/structural',
]);

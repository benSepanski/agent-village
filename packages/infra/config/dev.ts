import type { EnvConfig } from './types.js';

export const devConfig: EnvConfig = {
  env: 'dev',
  prefix: 'agent-village-dev',
  region: 'us-east-1',
  retainOnDelete: false,
  runnerMemoryMb: 256,
  apiMemoryMb: 256,
  logRetentionDays: 7,
  sandboxTaskCpu: 256,
  sandboxTaskMemoryMb: 512,
  monthlyBudgetUsd: 5,
  alarmEmail: 'ben.sepanski@gmail.com',
};

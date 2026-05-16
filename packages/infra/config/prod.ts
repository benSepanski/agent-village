import type { EnvConfig } from './types.js';

export const prodConfig: EnvConfig = {
  env: 'prod',
  prefix: 'agent-village-prod',
  region: 'us-east-1',
  retainOnDelete: true,
  runnerMemoryMb: 512,
  apiMemoryMb: 384,
  logRetentionDays: 30,
  monthlyBudgetUsd: 20,
  alarmEmail: 'ben.sepanski@gmail.com',
};

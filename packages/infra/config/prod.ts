import type { EnvConfig } from './types.js';

// Pins the prod deploy target: when set (CI repo variable, or replace with the
// literal account id), CDK refuses to deploy these stacks with credentials for
// any other account. Unset falls back to CDK_DEFAULT_ACCOUNT (the deployer's
// credentials), the pre-pinning behavior.
const prodAccountId = process.env['AV_PROD_ACCOUNT_ID'];

export const prodConfig: EnvConfig = {
  env: 'prod',
  prefix: 'agent-village-prod',
  region: 'us-east-1',
  account: prodAccountId,
  retainOnDelete: true,
  runnerMemoryMb: 512,
  apiMemoryMb: 384,
  logRetentionDays: 30,
  sandboxTaskCpu: 512,
  sandboxTaskMemoryMb: 1024,
  monthlyBudgetUsd: 20,
  alarmEmail: 'ben.sepanski@gmail.com',
};

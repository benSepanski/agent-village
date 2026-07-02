import type { EnvConfig } from './types.js';

export const prodConfig: EnvConfig = {
  env: 'prod',
  prefix: 'agent-village-prod',
  region: 'us-east-1',
  retainOnDelete: true,
  runnerMemoryMb: 512,
  apiMemoryMb: 384,
  logRetentionDays: 30,
  sandboxTaskCpu: 512,
  sandboxTaskMemoryMb: 1024,
  monthlyBudgetUsd: 20,
  alarmEmail: 'ben.sepanski@gmail.com',
  // sesSenderDomain: set to a verified SES identity (e.g. 'mail.example.com')
  // to enable agent `ses` grants in prod. Left unset until a domain is verified.
};

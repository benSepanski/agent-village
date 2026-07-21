import { devConfig } from './dev.js';
import { prodConfig } from './prod.js';
import type { EnvConfig } from './types.js';

export type { EnvConfig } from './types.js';

const CONFIGS: Record<EnvConfig['env'], EnvConfig> = {
  dev: devConfig,
  prod: prodConfig,
};

export function loadEnvConfig(envName: string | undefined): EnvConfig {
  if (envName !== 'dev' && envName !== 'prod') {
    throw new Error(
      `Unknown env "${envName ?? ''}". Pass --context env=dev or --context env=prod to cdk.`,
    );
  }
  const base = CONFIGS[envName];
  // A config-pinned account wins; CDK_DEFAULT_ACCOUNT (whoever is deploying)
  // is only a fallback — otherwise pinning would never reject mismatched creds.
  const account = base.account ?? process.env['CDK_DEFAULT_ACCOUNT'];
  return account ? { ...base, account } : base;
}

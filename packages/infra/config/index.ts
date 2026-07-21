import { readFileSync } from 'node:fs';
import { EnvConfigSchema } from './schema.js';
import { devConfig } from './dev.js';
import { prodConfig } from './prod.js';
import type { EnvConfig, FirstPartyEnv } from './types.js';

export type { EnvConfig, FirstPartyEnv } from './types.js';
export { EnvConfigSchema, RESERVED_PREFIXES, FIRST_PARTY_ENVS } from './schema.js';

const CONFIGS: Record<FirstPartyEnv, EnvConfig> = {
  dev: devConfig,
  prod: prodConfig,
};

function unknownEnvMessage(envName: string): string {
  return (
    `Unknown env "${envName}". Pass --context env=dev or --context env=prod to cdk, ` +
    'or --context env=<name> (name other than dev/prod) together with ' +
    'AV_ENV_CONFIG_PATH pointing at a JSON EnvConfig file. ' +
    'See docs/app-development.md for the injection contract.'
  );
}

function isFirstPartyEnv(envName: string): envName is FirstPartyEnv {
  return envName === 'dev' || envName === 'prod';
}

/** Config-pinned account wins; CDK_DEFAULT_ACCOUNT (whoever is deploying) is
 * only a fallback — otherwise pinning would never reject mismatched creds. */
function withAccountFallback(config: EnvConfig): EnvConfig {
  const account = config.account ?? process.env['CDK_DEFAULT_ACCOUNT'];
  return account ? { ...config, account } : config;
}

/** Loads and validates an injected `EnvConfig` from the JSON file at `path`. */
function loadInjectedConfig(envName: string, path: string): EnvConfig {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const parsed = EnvConfigSchema.parse(raw);
  if (parsed.env !== envName) {
    throw new Error(
      `AV_ENV_CONFIG_PATH config has env "${parsed.env}" but --context env=${envName} was passed. ` +
        "The injected config's env must match the --context env value.",
    );
  }
  return parsed;
}

export function loadEnvConfig(envName: string | undefined): EnvConfig {
  if (envName === undefined || envName === '') {
    throw new Error(unknownEnvMessage(envName ?? ''));
  }
  if (isFirstPartyEnv(envName)) {
    return withAccountFallback(CONFIGS[envName]);
  }
  const configPath = process.env['AV_ENV_CONFIG_PATH'];
  if (!configPath) {
    throw new Error(unknownEnvMessage(envName));
  }
  return withAccountFallback(loadInjectedConfig(envName, configPath));
}

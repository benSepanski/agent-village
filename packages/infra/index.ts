/**
 * Package entrypoint for `@agent-village/infra` — the "Advanced case" in
 * docs/app-development.md (Path B). A dependent repo forking the deploy
 * imports `buildApp` + `EnvConfigSchema` from here to construct its own
 * `bin/app.ts` around a programmatically-built `EnvConfig`, instead of
 * relying on the `AV_ENV_CONFIG_PATH` JSON-file injection (the "Simple
 * case").
 *
 * Kept deliberately small: re-exports the two integration points
 * (`buildApp`, the config loader/schema/types) rather than every internal
 * stack class, which stay implementation details of this package.
 */
export { buildApp } from './src/app-builder.js';
export {
  loadEnvConfig,
  EnvConfigSchema,
  RESERVED_PREFIXES,
  FIRST_PARTY_ENVS,
} from './config/index.js';
export type { EnvConfig, FirstPartyEnv } from './config/index.js';

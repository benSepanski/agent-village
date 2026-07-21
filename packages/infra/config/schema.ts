import { z } from 'zod';
import type { EnvConfig, FirstPartyEnv } from './types.js';

/** `env` values reserved for the first-party configs (config/dev.ts, config/prod.ts). */
export const FIRST_PARTY_ENVS: readonly FirstPartyEnv[] = ['dev', 'prod'];

/**
 * Resource-name prefixes reserved for the first-party deploys. An injected
 * `EnvConfig` (see config/index.ts) may not reuse one — doing so would let a
 * dependent deployment shadow or overwrite first-party stacks in a shared
 * AWS account (stack/bucket/table names all derive from `prefix`).
 */
export const RESERVED_PREFIXES: readonly string[] = ['agent-village-dev', 'agent-village-prod'];

const PREFIX_MAX = 40;
/** S3/DNS-safe: lowercase alphanumeric + hyphen, starting with a letter. */
const PREFIX_REGEX = /^[a-z][a-z0-9-]*$/;

const ENV_MAX = 40;

/**
 * Zod mirror of the {@link EnvConfig} interface, used to validate an
 * `EnvConfig` injected via `AV_ENV_CONFIG_PATH` (config/index.ts). Adds the
 * collision guards a plain interface can't enforce: `env` may not be
 * `dev`/`prod` and `prefix` may not be a reserved (first-party) prefix.
 * `.strict()` additionally rejects any unrecognized key so a misspelled
 * optional field (e.g. `sesSenderDomain` typo'd) fails loudly instead of
 * being silently dropped and disabling the feature it configures.
 *
 * Cross-deployment uniqueness beyond this reserved list (e.g. two dependent
 * repos both choosing `prefix: "my-app"` in the same account) can't be
 * enforced from a single synth — see docs/key-properties/multiple-deployments.md.
 */
export const EnvConfigSchema = z
  .object({
    env: z
      .string()
      .min(1)
      .max(ENV_MAX)
      .refine((env) => !FIRST_PARTY_ENVS.includes(env as FirstPartyEnv), {
        message: `"dev" and "prod" are reserved for the first-party configs — choose a different env name for an injected config`,
      }),
    prefix: z
      .string()
      .min(1)
      .max(PREFIX_MAX)
      .regex(PREFIX_REGEX, 'must be lowercase alphanumeric/hyphen, starting with a letter')
      .refine((prefix) => !RESERVED_PREFIXES.includes(prefix), {
        message: `prefix is reserved for a first-party deploy (${RESERVED_PREFIXES.join(', ')})`,
      }),
    region: z.string().min(1),
    account: z.string().min(1).optional(),
    retainOnDelete: z.boolean(),
    runnerMemoryMb: z.number().positive(),
    apiMemoryMb: z.number().positive(),
    logRetentionDays: z.number().positive(),
    sandboxTaskCpu: z.number().positive(),
    sandboxTaskMemoryMb: z.number().positive(),
    monthlyBudgetUsd: z.number().min(1),
    budgetDriftThresholdUsd: z.number().positive(),
    alarmEmail: z.string().email(),
    webDomain: z.string().min(1).optional(),
    sesSenderDomain: z.string().min(1).optional(),
    googleClientId: z.string().min(1).optional(),
    oauthCallbackUrls: z.array(z.string().min(1)).readonly().optional(),
  })
  .strict();

export type EnvConfigSchemaType = z.infer<typeof EnvConfigSchema>;

// Type-parity guard: fails to typecheck if EnvConfigSchema and the EnvConfig
// interface drift apart in either direction. Never called at runtime.
function _typeParityGuard(a: EnvConfigSchemaType): EnvConfig {
  return a;
}
function _typeParityGuardReverse(a: EnvConfig): EnvConfigSchemaType {
  return a;
}
void _typeParityGuard;
void _typeParityGuardReverse;

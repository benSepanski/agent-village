import { z } from 'zod';
import { AgentId, UserId } from './ids.js';
import { ApplicationManifest } from './manifest.js';

// Keep in sync with the pricing table in @agent-village/domain cost.ts —
// the metering gateway rejects (400) any model id it cannot price.
export const ANTHROPIC_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
] as const;

export const AnthropicModel = z.enum(ANTHROPIC_MODELS);
export type AnthropicModel = z.infer<typeof AnthropicModel>;

export const AgentStatus = z.enum(['active', 'paused']);
export type AgentStatus = z.infer<typeof AgentStatus>;

const NAME_MAX = 80;
const PROMPT_MAX = 20_000;

/**
 * Launcher-managed cache of the per-image task definition registered for a
 * custom `manifest.image` (Phase 4 step 03). Internal: deliberately absent
 * from CreateAgentInput/UpdateAgentInput, so users can never point an agent
 * at an arbitrary task definition. Valid only while `image` matches the
 * manifest and `baseArn` matches the deployed static definition (its revision
 * changes on platform redeploy, invalidating the cache).
 */
export const SandboxTaskDefCache = z.object({
  /** The manifest.image tag `arn` was registered for. */
  image: z.string().min(1),
  /** Static task-definition revision ARN the clone was derived from. */
  baseArn: z.string().min(1),
  /** Registered per-image task-definition ARN. */
  arn: z.string().min(1),
});
export type SandboxTaskDefCache = z.infer<typeof SandboxTaskDefCache>;

export const AgentSchema = z.object({
  id: AgentId,
  ownerSub: UserId,
  name: z.string().min(1).max(NAME_MAX),
  model: AnthropicModel,
  systemPrompt: z.string().min(1).max(PROMPT_MAX),
  schedule: z.string().min(1).nullable(),
  spendLimitUsd: z.number().positive(),
  spendUsedUsd: z.number().nonnegative(),
  anthropicSecretArn: z.string().min(1),
  status: AgentStatus,
  // Phase-2 containerized application contract; null for inline (Phase-1)
  // agents. The runner launches a sandbox task when this is set.
  manifest: ApplicationManifest.nullable().default(null),
  // Holds the in-flight run id while a sandbox run is active; enforces the
  // one-concurrent-run-per-agent invariant. Null when no run is in flight.
  activeRunId: z.string().nullable().default(null),
  // Launcher-managed per-image task-definition cache; null until a custom
  // manifest.image first launches. Never settable through the input schemas.
  sandboxTaskDef: SandboxTaskDefCache.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const CreateAgentInput = z.object({
  name: z.string().min(1).max(NAME_MAX),
  model: AnthropicModel,
  systemPrompt: z.string().min(1).max(PROMPT_MAX),
  schedule: z.string().min(1).nullable(),
  spendLimitUsd: z.number().positive(),
  anthropicApiKey: z.string().min(1),
  status: AgentStatus.optional(),
  manifest: ApplicationManifest.nullable().optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInput>;

export const UpdateAgentInput = z
  .object({
    name: z.string().min(1).max(NAME_MAX),
    model: AnthropicModel,
    systemPrompt: z.string().min(1).max(PROMPT_MAX),
    schedule: z.string().min(1).nullable(),
    spendLimitUsd: z.number().positive(),
    anthropicApiKey: z.string().min(1),
    status: AgentStatus,
    manifest: ApplicationManifest.nullable(),
  })
  .partial();
export type UpdateAgentInput = z.infer<typeof UpdateAgentInput>;

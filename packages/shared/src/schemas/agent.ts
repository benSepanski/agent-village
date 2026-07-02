import { z } from 'zod';
import { AgentId, UserId } from './ids.js';
import { ApplicationManifest } from './manifest.js';

export const ANTHROPIC_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
] as const;

export const AnthropicModel = z.enum(ANTHROPIC_MODELS);
export type AnthropicModel = z.infer<typeof AnthropicModel>;

export const AgentStatus = z.enum(['active', 'paused']);
export type AgentStatus = z.infer<typeof AgentStatus>;

const NAME_MAX = 80;
const PROMPT_MAX = 20_000;

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

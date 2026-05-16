import { z } from 'zod';
import { AgentId, RunId, UserId } from './ids.js';
import { AnthropicModel } from './agent.js';

export const RunStatus = z.enum(['ok', 'error', 'spend_limit_exceeded']);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunSchema = z.object({
  id: RunId,
  agentId: AgentId,
  ownerSub: UserId,
  status: RunStatus,
  costUsd: z.number().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  traceId: z.string().min(1),
  model: AnthropicModel,
  systemPromptHash: z.string().min(1),
  dryRun: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Run = z.infer<typeof RunSchema>;

export const RunPersisted = RunSchema;
export type RunPersisted = z.infer<typeof RunPersisted>;

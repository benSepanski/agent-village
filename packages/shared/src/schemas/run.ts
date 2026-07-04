import { z } from 'zod';
import { AgentId, RunId, UserId } from './ids.js';
import { AnthropicModel } from './agent.js';

export const RunStatus = z.enum([
  'ok',
  'error',
  'spend_limit_exceeded',
  // Sandbox (Phase-2) lifecycle states:
  'running',
  'timed_out',
  'launch_failed',
]);
export type RunStatus = z.infer<typeof RunStatus>;

/** Distinguishes a Phase-1 inline Anthropic call from a Phase-2 sandbox task. */
export const RunKind = z.enum(['inline', 'sandbox']);
export type RunKind = z.infer<typeof RunKind>;

export const RunSchema = z
  .object({
    id: RunId,
    agentId: AgentId,
    ownerSub: UserId,
    status: RunStatus,
    // Defaults to 'inline' so every Phase-1 run persisted before this field
    // existed still parses unchanged.
    kind: RunKind.default('inline'),
    costUsd: z.number().nonnegative(),
    tokensIn: z.number().int().nonnegative().default(0),
    tokensOut: z.number().int().nonnegative().default(0),
    output: z.string().nullable(),
    error: z.string().nullable(),
    durationMs: z.number().int().nonnegative(),
    traceId: z.string().min(1),
    // Null for sandbox runs — there is no single Anthropic model/prompt.
    model: AnthropicModel.nullable().default(null),
    systemPromptHash: z.string().min(1).nullable().default(null),
    dryRun: z.boolean(),
    /** When this run was triggered as a replay, the id of the original run. */
    replayOfRunId: RunId.nullable().default(null),
    /** ECS task ARN for sandbox runs; null for inline runs. */
    taskArn: z.string().min(1).nullable().default(null),
    /** Application exit code captured when a sandbox task stops; null otherwise. */
    exitCode: z.number().int().nullable().default(null),
    /**
     * SHA-256 hex of the secret part of this run's Anthropic-gateway bearer
     * token (ADR 0004). Set at sandbox launch; null for inline runs. The token
     * itself is never persisted.
     */
    gatewayTokenHash: z.string().min(1).nullable().default(null),
    createdAt: z.string().datetime(),
  })
  // Inline runs must keep their Anthropic-specific fields — a sandbox run is the
  // only kind allowed to leave model/systemPromptHash null.
  .superRefine((run, ctx) => {
    if (run.kind !== 'inline') return;
    if (run.model === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'inline runs require a model',
      });
    }
    if (run.systemPromptHash === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['systemPromptHash'],
        message: 'inline runs require a systemPromptHash',
      });
    }
  });
export type Run = z.infer<typeof RunSchema>;

export const RunPersisted = RunSchema;
export type RunPersisted = z.infer<typeof RunPersisted>;

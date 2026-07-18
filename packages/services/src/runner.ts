import Anthropic from '@anthropic-ai/sdk';
import { agentRepo, runRepo, secrets } from '@agent-village/data';
import {
  AgentNotFoundError,
  ReplayPromptMismatchError,
  RunNotFoundError,
  SpendLimitExceededError,
  actualCost,
  estimateCost,
  hashSystemPrompt,
} from '@agent-village/domain';
import {
  RunId as RunIdSchema,
  RunSchema,
  runOutcomeMetric,
  type Agent,
  type AgentId,
  type Run,
  type RunEvent,
  type RunEventName,
  type RunId,
  type RunStatus,
  type UserId,
} from '@agent-village/shared';
import { executeSandboxRun } from './runner-sandbox.js';
import { logger } from './logger.js';
import { ulid } from './ulid.js';

export { finalizeSandboxRun } from './sandbox-lifecycle.js';
export type { FinalizeSandboxRunInput } from './sandbox-lifecycle.js';
export { sweepStuckSandboxRuns, MAX_SANDBOX_RUN_MINUTES } from './sandbox-sweeper.js';
export type { SweepResult } from './sandbox-sweeper.js';
export { getRunLogs } from './run-logs.js';
export type { RunLogEvent, RunLogsPage, RunLogsQuery } from './run-logs.js';
export { getRun, listForAgent, monthToDateSpend } from './run-queries.js';
export type { MonthToDateSpend } from './run-queries.js';

const MAX_TOKENS = 1024;
const DRY_RUN_MAX_TOKENS = 256;
const USER_MESSAGE = 'Run.';

export interface ExecuteRunInput {
  agentId: AgentId;
  dryRun?: boolean;
  replayOfRunId?: RunId;
  /**
   * When set (user-initiated runs), the agent is loaded owner-scoped so callers
   * can only run their own agents. Omit for trusted schedule-driven invocations.
   */
  ownerSub?: UserId;
}

export interface ExecuteRunResult {
  runId: RunId;
  status: RunStatus;
}

interface RunContext {
  agentId: AgentId;
  runId: RunId;
  traceId: string;
  startedAt: number;
  dryRun: boolean;
  replayOfRunId?: RunId;
  ownerSub?: UserId;
  maxTokens: number;
}

interface CallResult {
  status: RunStatus;
  output: string;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
}

type AnthropicFactory = (apiKey: string) => Anthropic;

let factoryOverride: AnthropicFactory | undefined;

export function setAnthropicFactory(factory: AnthropicFactory | undefined): void {
  factoryOverride = factory;
}

function createAnthropic(apiKey: string): Anthropic {
  return factoryOverride ? factoryOverride(apiKey) : new Anthropic({ apiKey });
}

function makeContext(input: ExecuteRunInput): RunContext {
  const ctx: RunContext = {
    agentId: input.agentId,
    runId: RunIdSchema.parse(ulid()),
    traceId: process.env['_X_AMZN_TRACE_ID'] ?? `local-${ulid()}`,
    startedAt: Date.now(),
    dryRun: input.dryRun === true,
    maxTokens: input.dryRun === true ? DRY_RUN_MAX_TOKENS : MAX_TOKENS,
  };
  if (input.replayOfRunId !== undefined) ctx.replayOfRunId = input.replayOfRunId;
  if (input.ownerSub !== undefined) ctx.ownerSub = input.ownerSub;
  return ctx;
}

async function loadAgent(ctx: RunContext): Promise<Agent> {
  // Owner-scoped read for user-initiated runs; unscoped lookup for the trusted
  // schedule path. A missing OR non-owned agent both surface as "not found".
  const agent =
    ctx.ownerSub !== undefined
      ? await agentRepo.getAgent(ctx.ownerSub, ctx.agentId)
      : await agentRepo.getAgentById(ctx.agentId);
  if (!agent) throw new AgentNotFoundError(ctx.agentId);
  logger.info({
    event: 'agent.run.config_loaded',
    agentId: agent.id,
    runId: ctx.runId,
    traceId: ctx.traceId,
  });
  return agent;
}

/**
 * Validate a replay request: the original run must exist for this agent, and the
 * agent's current system prompt must still hash to what the original captured —
 * otherwise the replay would not reproduce the original conditions.
 */
async function verifyReplay(ctx: RunContext, agent: Agent): Promise<void> {
  if (ctx.replayOfRunId === undefined) return;
  const original = await runRepo.getOne(agent.id, ctx.replayOfRunId);
  if (!original) throw new RunNotFoundError(agent.id, ctx.replayOfRunId);
  if (original.systemPromptHash !== hashSystemPrompt(agent.systemPrompt)) {
    throw new ReplayPromptMismatchError(agent.id, ctx.replayOfRunId);
  }
}

async function reserve(ctx: RunContext, agent: Agent, estimateUsd: number): Promise<boolean> {
  try {
    await agentRepo.reserveSpend({ agentId: agent.id, ownerSub: agent.ownerSub, estimateUsd });
    logger.info({
      event: 'agent.run.spend_reserved',
      agentId: agent.id,
      runId: ctx.runId,
      traceId: ctx.traceId,
      metric: { 'spend.reserved_usd': estimateUsd },
    });
    return true;
  } catch (err) {
    if (err instanceof SpendLimitExceededError) {
      logger.warn({
        event: 'agent.run.spend_rejected',
        agentId: agent.id,
        runId: ctx.runId,
        traceId: ctx.traceId,
        // Real EMF datapoint for the spend-rejected alarm (Phase 3 step 07).
        ...runOutcomeMetric('spend_limit_exceeded'),
      });
      return false;
    }
    throw err;
  }
}

async function callAnthropic(ctx: RunContext, agent: Agent, apiKey: string): Promise<CallResult> {
  logger.info({
    event: 'agent.run.anthropic_call',
    agentId: agent.id,
    runId: ctx.runId,
    traceId: ctx.traceId,
    model: agent.model,
    maxTokens: ctx.maxTokens,
  });
  try {
    const response = await createAnthropic(apiKey).messages.create({
      model: agent.model,
      max_tokens: ctx.maxTokens,
      system: agent.systemPrompt,
      messages: [{ role: 'user', content: USER_MESSAGE }],
    });
    const text = response.content.find((b) => b.type === 'text');
    return {
      status: 'ok',
      output: text && text.type === 'text' ? text.text : '',
      error: null,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    };
  } catch (err) {
    logger.error({
      event: 'agent.run.failed',
      agentId: agent.id,
      runId: ctx.runId,
      traceId: ctx.traceId,
      err,
    });
    return {
      status: 'error',
      output: '',
      error: err instanceof Error ? err.message : String(err),
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}

function inlineTerminalEventName(status: RunStatus): RunEventName {
  if (status === 'ok') return 'agent.run.completed';
  if (status === 'spend_limit_exceeded') return 'agent.run.spend_rejected';
  return 'agent.run.failed';
}

/**
 * Real (measured, not interpolated) lifecycle events for an inline run: the
 * run started at `startedAt` and reached its terminal state `durationMs`
 * later — both timestamps the runner itself observed.
 */
function inlineRunEvents(ctx: RunContext, status: RunStatus, durationMs: number): RunEvent[] {
  return [
    { event: 'agent.run.started', at: new Date(ctx.startedAt).toISOString() },
    {
      event: inlineTerminalEventName(status),
      at: new Date(ctx.startedAt + durationMs).toISOString(),
    },
  ];
}

function buildRun(ctx: RunContext, agent: Agent, result: CallResult): Run {
  const durationMs = Date.now() - ctx.startedAt;
  return RunSchema.parse({
    id: ctx.runId,
    agentId: agent.id,
    ownerSub: agent.ownerSub,
    status: result.status,
    costUsd: actualCost(agent.model, {
      inputTokens: result.tokensIn,
      outputTokens: result.tokensOut,
    }),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    output: result.status === 'ok' ? result.output : null,
    error: result.error,
    durationMs,
    traceId: ctx.traceId,
    model: agent.model,
    systemPromptHash: hashSystemPrompt(agent.systemPrompt),
    dryRun: ctx.dryRun,
    replayOfRunId: ctx.replayOfRunId ?? null,
    events: inlineRunEvents(ctx, result.status, durationMs),
    createdAt: new Date(ctx.startedAt).toISOString(),
  });
}

/** Common structured-log fields for a run. */
const runLog = (ctx: RunContext): { agentId: AgentId; runId: RunId; traceId: string } => ({
  agentId: ctx.agentId,
  runId: ctx.runId,
  traceId: ctx.traceId,
});

async function appendRejected(ctx: RunContext, agent: Agent): Promise<Run> {
  const run = buildRun(ctx, agent, {
    status: 'spend_limit_exceeded',
    output: '',
    error: 'spend limit exceeded; Anthropic call skipped',
    tokensIn: 0,
    tokensOut: 0,
  });
  await runRepo.append(run);
  logger.info({ event: 'agent.run.persisted', ...runLog(ctx) });
  return run;
}

/** Release a reservation that was never finalized (e.g. the call setup threw). */
async function refundReservation(
  ctx: RunContext,
  agent: Agent,
  estimateUsd: number,
): Promise<void> {
  try {
    await agentRepo.finalizeSpend({
      agentId: agent.id,
      ownerSub: agent.ownerSub,
      deltaUsd: -estimateUsd,
    });
    logger.warn({ event: 'agent.run.spend_refunded', ...runLog(ctx) });
  } catch (refundErr) {
    logger.error({ event: 'agent.run.spend_refund_failed', ...runLog(ctx), err: refundErr });
  }
}

/**
 * Run the Anthropic call, reconcile reserved spend against actual, and persist
 * the run. Any failure before spend is finalized refunds the reservation, so it
 * never leaks permanently into spendUsedUsd.
 */
async function executeReserved(ctx: RunContext, agent: Agent, estimateUsd: number): Promise<Run> {
  let finalized = false;
  try {
    const apiKey = await secrets.getAnthropicKey(agent.anthropicSecretArn);
    logger.info({ event: 'agent.run.secret_fetched', ...runLog(ctx) });
    const run = buildRun(ctx, agent, await callAnthropic(ctx, agent, apiKey));
    const deltaUsd = run.costUsd - estimateUsd;
    await agentRepo.finalizeSpend({ agentId: agent.id, ownerSub: agent.ownerSub, deltaUsd });
    finalized = true;
    logger.info({
      event: 'agent.run.spend_finalized',
      ...runLog(ctx),
      metric: { 'spend.actual_usd': run.costUsd, 'spend.delta_usd': deltaUsd },
    });
    await runRepo.append(run);
    logger.info({ event: 'agent.run.persisted', ...runLog(ctx) });
    return run;
  } catch (err) {
    if (!finalized) await refundReservation(ctx, agent, estimateUsd);
    throw err;
  }
}

export async function executeRun(input: ExecuteRunInput): Promise<ExecuteRunResult> {
  const ctx = makeContext(input);
  logger.info({
    event: 'agent.run.started',
    ...runLog(ctx),
    dryRun: ctx.dryRun,
    replayOfRunId: ctx.replayOfRunId ?? null,
  });
  const agent = await loadAgent(ctx);
  // Agents with a manifest run as a sandboxed Fargate task (async). The run
  // record finishes via the lifecycle handler, not inline here.
  if (agent.manifest) return executeSandboxRun(ctx, agent);
  await verifyReplay(ctx, agent);
  // Price input from the actual prompt size so the reservation upper-bounds the
  // finalized cost (a 20k-char system prompt is ~$0.05 of input on fable-5).
  const estimateUsd = estimateCost(
    agent.model,
    ctx.maxTokens,
    agent.systemPrompt.length + USER_MESSAGE.length,
  );
  if (!(await reserve(ctx, agent, estimateUsd))) {
    const rejected = await appendRejected(ctx, agent);
    return { runId: rejected.id, status: rejected.status };
  }
  const run = await executeReserved(ctx, agent, estimateUsd);
  logger.info({
    event: 'agent.run.completed',
    ...runLog(ctx),
    status: run.status,
    metric: { 'run.cost_usd': run.costUsd, 'run.duration_ms': run.durationMs },
    // Real EMF datapoint for the runs.error alarm when the call failed.
    ...runOutcomeMetric(run.status),
  });
  return { runId: run.id, status: run.status };
}

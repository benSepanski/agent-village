import Anthropic from '@anthropic-ai/sdk';
import { agentRepo, runRepo, secrets } from '@agent-village/data';
import {
  AgentNotFoundError,
  SpendLimitExceededError,
  actualCost,
  estimateCost,
  hashSystemPrompt,
} from '@agent-village/domain';
import {
  RunId as RunIdSchema,
  RunSchema,
  type Agent,
  type AgentId,
  type Run,
  type RunId,
  type RunStatus,
} from '@agent-village/shared';
import { logger } from './logger.js';
import { ulid } from './ulid.js';

const MAX_TOKENS = 1024;
const DRY_RUN_MAX_TOKENS = 256;
const USER_MESSAGE = 'Run.';

export interface ExecuteRunInput {
  agentId: AgentId;
  dryRun?: boolean;
  replayOfRunId?: RunId;
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
  return ctx;
}

async function loadAgent(ctx: RunContext): Promise<Agent> {
  const agent = await agentRepo.getAgentById(ctx.agentId);
  if (!agent) throw new AgentNotFoundError(ctx.agentId);
  logger.info({
    event: 'agent.run.config_loaded',
    agentId: agent.id,
    runId: ctx.runId,
    traceId: ctx.traceId,
  });
  return agent;
}

async function reserve(ctx: RunContext, agent: Agent): Promise<boolean> {
  const estimateUsd = estimateCost(agent.model, ctx.maxTokens);
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

function buildRun(ctx: RunContext, agent: Agent, result: CallResult): Run {
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
    durationMs: Date.now() - ctx.startedAt,
    traceId: ctx.traceId,
    model: agent.model,
    systemPromptHash: hashSystemPrompt(agent.systemPrompt),
    dryRun: ctx.dryRun,
    createdAt: new Date(ctx.startedAt).toISOString(),
  });
}

async function appendRejected(ctx: RunContext, agent: Agent): Promise<Run> {
  const run = buildRun(ctx, agent, {
    status: 'spend_limit_exceeded',
    output: '',
    error: 'spend limit exceeded; Anthropic call skipped',
    tokensIn: 0,
    tokensOut: 0,
  });
  await runRepo.append(run);
  logger.info({
    event: 'agent.run.persisted',
    agentId: agent.id,
    runId: ctx.runId,
    traceId: ctx.traceId,
  });
  return run;
}

async function appendCompleted(ctx: RunContext, agent: Agent, result: CallResult): Promise<Run> {
  const estimateUsd = estimateCost(agent.model, ctx.maxTokens);
  const run = buildRun(ctx, agent, result);
  await agentRepo.finalizeSpend({
    agentId: agent.id,
    ownerSub: agent.ownerSub,
    deltaUsd: run.costUsd - estimateUsd,
  });
  logger.info({
    event: 'agent.run.spend_finalized',
    agentId: agent.id,
    runId: ctx.runId,
    traceId: ctx.traceId,
    metric: { 'spend.actual_usd': run.costUsd, 'spend.delta_usd': run.costUsd - estimateUsd },
  });
  await runRepo.append(run);
  logger.info({
    event: 'agent.run.persisted',
    agentId: agent.id,
    runId: ctx.runId,
    traceId: ctx.traceId,
  });
  return run;
}

export async function executeRun(input: ExecuteRunInput): Promise<ExecuteRunResult> {
  const ctx = makeContext(input);
  logger.info({
    event: 'agent.run.started',
    agentId: ctx.agentId,
    runId: ctx.runId,
    traceId: ctx.traceId,
    dryRun: ctx.dryRun,
    replayOfRunId: ctx.replayOfRunId ?? null,
  });
  const agent = await loadAgent(ctx);
  const reserved = await reserve(ctx, agent);
  if (!reserved) {
    const run = await appendRejected(ctx, agent);
    return { runId: run.id, status: run.status };
  }
  const apiKey = await secrets.getAnthropicKey(agent.anthropicSecretArn);
  logger.info({
    event: 'agent.run.secret_fetched',
    agentId: agent.id,
    runId: ctx.runId,
    traceId: ctx.traceId,
  });
  const result = await callAnthropic(ctx, agent, apiKey);
  const run = await appendCompleted(ctx, agent, result);
  logger.info({
    event: 'agent.run.completed',
    agentId: agent.id,
    runId: ctx.runId,
    traceId: ctx.traceId,
    status: run.status,
    metric: { 'run.cost_usd': run.costUsd, 'run.duration_ms': run.durationMs },
  });
  return { runId: run.id, status: run.status };
}

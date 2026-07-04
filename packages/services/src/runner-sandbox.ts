import { agentRepo, runRepo } from '@agent-village/data';
import {
  AgentRunInProgressError,
  SpendLimitExceededError,
  estimateSandboxCost,
} from '@agent-village/domain';
import {
  RunSchema,
  type Agent,
  type AgentId,
  type Run,
  type RunId,
  type RunStatus,
} from '@agent-village/shared';
import { mintRunToken } from './gateway-token.js';
import { launchSandboxRun } from './sandbox.js';
import { logger } from './logger.js';

/** The subset of the runner's RunContext a sandbox launch needs. */
export interface SandboxRunContext {
  agentId: AgentId;
  runId: RunId;
  traceId: string;
  startedAt: number;
}

export interface SandboxRunResult {
  runId: RunId;
  status: RunStatus;
}

const DEFAULT_CPU = 256;
const DEFAULT_MEMORY_MB = 512;

function sandboxEstimate(timeoutMinutes: number): number {
  const cpu = Number(process.env['AV_SANDBOX_CPU'] ?? DEFAULT_CPU);
  const memMb = Number(process.env['AV_SANDBOX_MEMORY'] ?? DEFAULT_MEMORY_MB);
  return estimateSandboxCost(timeoutMinutes, cpu, memMb);
}

const runLog = (ctx: SandboxRunContext): { agentId: AgentId; runId: RunId; traceId: string } => ({
  agentId: ctx.agentId,
  runId: ctx.runId,
  traceId: ctx.traceId,
});

function buildSandboxRun(
  ctx: SandboxRunContext,
  agent: Agent,
  costUsd: number,
  gatewayTokenHash: string,
): Run {
  return RunSchema.parse({
    id: ctx.runId,
    agentId: agent.id,
    ownerSub: agent.ownerSub,
    status: 'running',
    kind: 'sandbox',
    costUsd,
    output: null,
    error: null,
    durationMs: 0,
    traceId: ctx.traceId,
    model: null,
    systemPromptHash: null,
    dryRun: false,
    taskArn: null,
    exitCode: null,
    gatewayTokenHash,
    createdAt: new Date(ctx.startedAt).toISOString(),
  });
}

async function reserveSandboxSpend(
  ctx: SandboxRunContext,
  agent: Agent,
  estimateUsd: number,
): Promise<boolean> {
  try {
    await agentRepo.reserveSpend({ agentId: agent.id, ownerSub: agent.ownerSub, estimateUsd });
    logger.info({
      event: 'agent.run.spend_reserved',
      ...runLog(ctx),
      metric: { 'spend.reserved_usd': estimateUsd },
    });
    return true;
  } catch (err) {
    if (err instanceof SpendLimitExceededError) {
      logger.warn({ event: 'agent.run.spend_rejected', ...runLog(ctx) });
      return false;
    }
    throw err;
  }
}

async function refund(ctx: SandboxRunContext, agent: Agent, estimateUsd: number): Promise<void> {
  await agentRepo.finalizeSpend({
    agentId: agent.id,
    ownerSub: agent.ownerSub,
    deltaUsd: -estimateUsd,
  });
  logger.warn({ event: 'agent.run.spend_refunded', ...runLog(ctx) });
}

async function appendRejected(ctx: SandboxRunContext, agent: Agent): Promise<Run> {
  const run = RunSchema.parse({
    id: ctx.runId,
    agentId: agent.id,
    ownerSub: agent.ownerSub,
    status: 'spend_limit_exceeded',
    kind: 'sandbox',
    costUsd: 0,
    output: null,
    error: 'spend limit exceeded; sandbox run skipped',
    durationMs: 0,
    traceId: ctx.traceId,
    model: null,
    systemPromptHash: null,
    dryRun: false,
    taskArn: null,
    exitCode: null,
    createdAt: new Date(ctx.startedAt).toISOString(),
  });
  await runRepo.append(run);
  logger.info({ event: 'agent.run.persisted', ...runLog(ctx) });
  return run;
}

/** Claim the run slot; refund the reservation and rethrow if one is already in flight. */
async function acquireGuard(
  ctx: SandboxRunContext,
  agent: Agent,
  estimateUsd: number,
): Promise<void> {
  try {
    await agentRepo.acquireActiveRun({
      agentId: agent.id,
      ownerSub: agent.ownerSub,
      runId: ctx.runId,
    });
  } catch (err) {
    if (err instanceof AgentRunInProgressError) await refund(ctx, agent, estimateUsd);
    throw err;
  }
}

async function onLaunchFailure(
  ctx: SandboxRunContext,
  agent: Agent,
  run: Run,
  errMessage: string,
): Promise<void> {
  await runRepo.patchRun(agent.id, run.createdAt, ctx.runId, {
    status: 'launch_failed',
    error: errMessage,
  });
  await agentRepo.releaseActiveRun({
    agentId: agent.id,
    ownerSub: agent.ownerSub,
    runId: ctx.runId,
  });
  await refund(ctx, agent, run.costUsd);
  logger.error({ event: 'sandbox.run.launch_failed', ...runLog(ctx) });
}

async function launchAndRecord(
  ctx: SandboxRunContext,
  agent: Agent,
  estimateUsd: number,
): Promise<SandboxRunResult> {
  const manifest = agent.manifest;
  if (!manifest) throw new Error('launchAndRecord requires a manifest');
  // Metered LLM access (ADR 0004): the run record keeps only the token's hash;
  // the full token travels to the task env via the launcher.
  const minted = mintRunToken(agent.id, ctx.runId);
  const run = buildSandboxRun(ctx, agent, estimateUsd, minted.tokenHash);
  await runRepo.append(run);
  logger.info({ event: 'agent.run.persisted', ...runLog(ctx) });
  try {
    const taskArn = await launchSandboxRun({
      agent,
      manifest,
      runId: ctx.runId,
      gatewayToken: minted.token,
    });
    await runRepo.patchRun(agent.id, run.createdAt, ctx.runId, { taskArn });
    return { runId: ctx.runId, status: 'running' };
  } catch (err) {
    await onLaunchFailure(ctx, agent, run, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Launch a sandboxed application run for an agent that has a manifest. Reserves
 * a flat estimated Fargate cost, claims the one-run-per-agent slot, writes a
 * `running` Run record, then starts the ECS task. The async lifecycle handler
 * later moves the run to a terminal status and releases the slot.
 */
export async function executeSandboxRun(
  ctx: SandboxRunContext,
  agent: Agent,
): Promise<SandboxRunResult> {
  const manifest = agent.manifest;
  if (!manifest) throw new Error('executeSandboxRun requires a manifest');
  const estimateUsd = sandboxEstimate(manifest.timeoutMinutes);
  if (!(await reserveSandboxSpend(ctx, agent, estimateUsd))) {
    const rejected = await appendRejected(ctx, agent);
    return { runId: rejected.id, status: rejected.status };
  }
  await acquireGuard(ctx, agent, estimateUsd);
  return launchAndRecord(ctx, agent, estimateUsd);
}

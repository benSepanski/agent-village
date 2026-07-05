import { agentRepo, runRepo } from '@agent-village/data';
import {
  AgentRunInProgressError,
  SpendLimitExceededError,
  estimateSandboxCost,
} from '@agent-village/domain';
import {
  RunSchema,
  runOutcomeMetric,
  type Agent,
  type AgentId,
  type Run,
  type RunId,
  type RunStatus,
} from '@agent-village/shared';
import { mintRunToken } from './gateway-token.js';
import { launchSandboxRun } from './sandbox.js';
import { sandboxTaskSize } from './sandbox-size.js';
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

function sandboxEstimate(timeoutMinutes: number): number {
  const { cpu, memMb } = sandboxTaskSize();
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
    // Honest-cost marker (Phase 3 step 06): the lifecycle handler reconciles
    // this flat compute reservation to actual duration and nulls the field.
    reservedUsd: costUsd,
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
    // First observed transition; the lifecycle handler appends the rest from
    // the ECS task-state-change event when the task stops.
    events: [{ event: 'sandbox.run.launched', at: new Date(ctx.startedAt).toISOString() }],
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
      logger.warn({
        event: 'agent.run.spend_rejected',
        ...runLog(ctx),
        // Real EMF datapoint for the spend-rejected alarm (Phase 3 step 07).
        ...runOutcomeMetric('spend_limit_exceeded'),
      });
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
    events: [{ event: 'agent.run.spend_rejected', at: new Date(ctx.startedAt).toISOString() }],
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
    // The reservation is refunded below — null the marker so a stray task-stop
    // event for a half-launched task cannot reconcile (i.e. refund) it again,
    // and zero the flat estimate so the run doesn't report cost that was
    // refunded (month-to-date sums costUsd).
    reservedUsd: null,
    costUsd: 0,
    events: [...run.events, { event: 'sandbox.run.launch_failed', at: new Date().toISOString() }],
  });
  await agentRepo.releaseActiveRun({
    agentId: agent.id,
    ownerSub: agent.ownerSub,
    runId: ctx.runId,
  });
  await refund(ctx, agent, run.costUsd);
  logger.error({
    event: 'sandbox.run.launch_failed',
    ...runLog(ctx),
    // Real EMF datapoint for the runs.error alarm (Phase 3 step 07).
    ...runOutcomeMetric('launch_failed'),
  });
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

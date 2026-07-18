import { agentRepo, runRepo } from '@agent-village/data';
import { actualSandboxCost } from '@agent-village/domain';
import { runOutcomeMetric } from '@agent-village/shared';
import type { AgentId, Run, RunEvent, RunId, RunStatus } from '@agent-village/shared';
import { logger } from './logger.js';
import { sandboxTaskSize } from './sandbox-size.js';
import { deleteRunWatchdog } from './sandbox-watchdog.js';

export interface FinalizeSandboxRunInput {
  agentId: AgentId;
  runId: RunId;
  /** App container exit code; null if the task stopped before the app reported one. */
  exitCode: number | null;
  /** ECS `stoppedReason`; used to detect timeouts and as the error message. */
  stoppedReason?: string;
  durationMs: number;
  /** ISO instant the task's containers started, from the ECS event (`startedAt`). */
  taskStartedAt?: string;
  /** ISO instant the task stopped, from the ECS event (`stoppedAt`). */
  taskStoppedAt?: string;
}

const TIMEOUT_MARKERS = ['timeout', 'timed out'];
/** GNU `timeout` exit status when the in-container fallback killed the app. */
const TIMEOUT_FALLBACK_EXIT_CODE = 124;

function isTimeout(reason: string): boolean {
  const lower = reason.toLowerCase();
  return TIMEOUT_MARKERS.some((marker) => lower.includes(marker));
}

function terminalStatus(exitCode: number | null, stoppedReason: string): RunStatus {
  if (isTimeout(stoppedReason) || exitCode === TIMEOUT_FALLBACK_EXIT_CODE) return 'timed_out';
  return exitCode === 0 ? 'ok' : 'error';
}

/** Idempotency marker: a run whose events already contain `finalized` was handled. */
function alreadyFinalized(existing: Run): boolean {
  return (existing.events ?? []).some((e) => e.event === 'sandbox.run.finalized');
}

/**
 * Real observed transitions appended to the run's event list (Phase 3 step
 * 07): task start/stop come straight from the ECS task-state-change event's
 * own timestamps; `finalized` is when this handler recorded the outcome. A
 * redelivered stop event (EventBridge is at-least-once) appends nothing.
 */
function terminalEvents(existing: Run, input: FinalizeSandboxRunInput): RunEvent[] {
  if (alreadyFinalized(existing)) return existing.events ?? [];
  const appended: RunEvent[] = [];
  if (input.taskStartedAt) {
    appended.push({ event: 'sandbox.run.task_started', at: input.taskStartedAt });
  }
  if (input.taskStoppedAt) {
    appended.push({ event: 'sandbox.run.task_stopped', at: input.taskStoppedAt });
  }
  appended.push({ event: 'sandbox.run.finalized', at: new Date().toISOString() });
  return [...(existing.events ?? []), ...appended];
}

/**
 * Reconcile the flat Fargate reservation held at launch to the task's actual
 * duration — the same `finalizeSpend` delta pattern the inline path uses. The
 * agent ledger gets the delta, and the run's accumulated `costUsd` (flat
 * compute + metered LLM usage) is shifted by the same delta so it reads as
 * actual compute + actual LLM cost. Failures are logged, never thrown: the
 * task already ran, and an unreconciled reservation only over-counts spend
 * (safe direction for a spend cap).
 *
 * Returns `true` only when THIS invocation won the atomic reservation claim —
 * the same single-fire signal that settles spend exactly once — so the caller
 * can gate the run-outcome EMF metric on it. A pre-read `alreadyFinalized`
 * snapshot cannot: two concurrently redelivered stop events both read it as
 * not-yet-finalized and would double-count the outcome.
 */
async function reconcileComputeSpend(existing: Run, durationMs: number): Promise<boolean> {
  // Claim the reservation atomically. A read-then-write marker is not enough:
  // EventBridge stop events are at-least-once and can be processed
  // CONCURRENTLY, and both deliveries would read the same pre-patch snapshot
  // and double-apply the delta. The conditional claim hands the reserved
  // amount to exactly one caller.
  let reservedUsd: number | null;
  try {
    reservedUsd = await runRepo.claimRunReservation(
      existing.agentId,
      existing.createdAt,
      existing.id,
    );
  } catch (err) {
    logger.error({
      event: 'sandbox.run.reconcile_failed',
      agentId: existing.agentId,
      runId: existing.id,
      err,
    });
    return false;
  }
  if (reservedUsd === null) return false; // inline/legacy run, or another settlement won
  const { cpu, memMb } = sandboxTaskSize();
  const actualUsd = actualSandboxCost(durationMs, cpu, memMb);
  const deltaUsd = actualUsd - reservedUsd;
  try {
    await agentRepo.finalizeSpend({
      agentId: existing.agentId,
      ownerSub: existing.ownerSub,
      deltaUsd,
    });
    // ADD (not SET): a straggler gateway reconciliation may still be appending
    // LLM usage onto costUsd, so shift it atomically instead of overwriting.
    await runRepo.addRunUsage(existing.agentId, existing.createdAt, existing.id, {
      costUsd: deltaUsd,
      tokensIn: 0,
      tokensOut: 0,
    });
    logger.info({
      event: 'sandbox.run.spend_reconciled',
      agentId: existing.agentId,
      runId: existing.id,
      metric: { 'spend.reserved_usd': reservedUsd, 'spend.actual_usd': actualUsd },
    });
  } catch (err) {
    logger.error({
      event: 'sandbox.run.reconcile_failed',
      agentId: existing.agentId,
      runId: existing.id,
      err,
    });
  }
  return true;
}

/**
 * Move a `running` sandbox run to its terminal state when the ECS task stops,
 * reconcile the flat launch-time compute reservation to the task's actual
 * duration, and release the agent's concurrent-run slot. A run that can't be
 * found (e.g. the task predates this code) is a no-op.
 */
export async function finalizeSandboxRun(input: FinalizeSandboxRunInput): Promise<void> {
  // The task has stopped, so the kill-switch schedule is moot regardless of
  // whether the run record exists — disarm it first (best effort, never throws).
  await deleteRunWatchdog(input.runId);
  const existing = await runRepo.getOne(input.agentId, input.runId);
  if (!existing) {
    logger.warn({
      event: 'sandbox.run.finalized',
      agentId: input.agentId,
      runId: input.runId,
      note: 'run_not_found',
    });
    return;
  }
  // A half-launched task (RunTask succeeded, launch failed later, e.g. watchdog
  // arming) was already fully settled by onLaunchFailure: status, refund, slot
  // release, and the EMF datapoint. The stop event for the aborted task must
  // not re-finalize it — that would overwrite launch_failed and double-count.
  if (existing.status === 'launch_failed') {
    logger.info({
      event: 'sandbox.run.finalized',
      agentId: input.agentId,
      runId: input.runId,
      note: 'already_launch_failed',
    });
    return;
  }
  const reason = input.stoppedReason ?? '';
  // A mid-run spend breach recorded by the metering gateway (ADR 0004) is the
  // most meaningful outcome — keep it (and its error) over the exit-code status.
  const breached = existing.status === 'spend_limit_exceeded';
  const status = breached ? existing.status : terminalStatus(input.exitCode, reason);
  await runRepo.patchRun(input.agentId, existing.createdAt, input.runId, {
    status,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    // reservedUsd is NOT nulled here — reconcileComputeSpend claims it with a
    // conditional write so concurrent redeliveries settle exactly once.
    // gatewayTokenHash IS nulled: the task has stopped, so the per-run metering
    // token must stop authenticating — including for a breached run, whose
    // status (spend_limit_exceeded) would otherwise keep it in the gateway's
    // ACTIVE_RUN_STATUSES set forever (ADR 0004: "a leaked token dies with its
    // run"). authenticate() rejects a run with no gatewayTokenHash.
    gatewayTokenHash: null,
    events: terminalEvents(existing, input),
    ...(breached
      ? {}
      : { error: status === 'ok' ? null : reason || `exit code ${input.exitCode}` }),
  });
  const settled = await reconcileComputeSpend(existing, input.durationMs);
  await agentRepo.releaseActiveRun({
    agentId: input.agentId,
    ownerSub: existing.ownerSub,
    runId: input.runId,
  });
  logger.info({
    event: 'sandbox.run.finalized',
    agentId: input.agentId,
    runId: input.runId,
    status,
    // Real EMF datapoint for the runs.error / spend-rejected alarms (Phase 3
    // step 07). Gated on the won reservation claim — the single-fire signal
    // that also settles spend exactly once — so a concurrently redelivered stop
    // event (both deliveries read the same pre-patch snapshot) still counts each
    // sandbox run outcome exactly once.
    ...(settled ? runOutcomeMetric(status) : {}),
  });
}

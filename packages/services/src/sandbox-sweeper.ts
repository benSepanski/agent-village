import { runRepo } from '@agent-village/data';
import type { Run } from '@agent-village/shared';
import { logger } from './logger.js';
import { finalizeSandboxRun } from './sandbox-lifecycle.js';
import { WATCHDOG_GRACE_MINUTES } from './sandbox-watchdog.js';

/**
 * Stuck-run sweeper (production-readiness backstop): a scheduled reconciler for
 * sandbox runs wedged in `status:'running'` because their terminal path never
 * ran — a poison-pill ECS stop event, or a multi-hour outage in the lifecycle
 * finalizer. Left alone, such a run permanently holds the agent's one-run slot.
 *
 * This is the LAST line of defense behind the in-container `timeout`, the
 * EventBridge Scheduler `StopTask` kill switch, and the lifecycle finalizer. It
 * settles each wedged run through the SAME `finalizeSandboxRun` path those use,
 * so reservation settlement stays fail-safe and idempotent (the atomic
 * reservation claim guarantees money moves exactly once even if the real stop
 * event arrives later, or two sweeps overlap).
 */

const MS_PER_MINUTE = 60_000;
/** Largest `manifest.timeoutMinutes` the schema allows (TIMEOUT_MINUTES_MAX). */
const MAX_MANIFEST_TIMEOUT_MINUTES = 120;
/**
 * Extra slack beyond the widest a healthy run could take so the sweeper NEVER
 * races a run that could still finish on its own. A run is only swept once it
 * has outlived the maximum manifest timeout PLUS the watchdog grace (which
 * absorbs Fargate provisioning + final workspace sync) PLUS this margin — the
 * deliberately-late, coarse threshold keeps the sweep strictly fail-safe.
 */
const SWEEPER_SAFETY_MARGIN_MINUTES = 30;

/** A run `running` longer than this is unambiguously wedged, not in flight. */
export const MAX_SANDBOX_RUN_MINUTES =
  MAX_MANIFEST_TIMEOUT_MINUTES + WATCHDOG_GRACE_MINUTES + SWEEPER_SAFETY_MARGIN_MINUTES;

/**
 * Marker in the synthetic `stoppedReason` so `finalizeSandboxRun` classifies a
 * swept run as `timed_out` (its `isTimeout` check matches "timed out").
 */
const SWEEP_STOPPED_REASON =
  'stuck-run sweeper: run exceeded its maximum lifetime and was timed out';

export interface SweepResult {
  /** Runs found wedged past the deadline this pass. */
  found: number;
  /** Runs successfully handed to finalizeSandboxRun this pass. */
  finalized: number;
}

/**
 * Finalize every sandbox run wedged in `running` past MAX_SANDBOX_RUN_MINUTES.
 * Each run is settled independently: one run that fails to finalize is logged
 * and skipped so it never blocks the rest of the sweep (the next pass retries).
 */
export async function sweepStuckSandboxRuns(now: Date = new Date()): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - MAX_SANDBOX_RUN_MINUTES * MS_PER_MINUTE).toISOString();
  const stuck = await runRepo.listStuckSandboxRuns(cutoff);
  if (stuck.length === 0) return { found: 0, finalized: 0 };
  let finalized = 0;
  for (const run of stuck) {
    if (await finalizeStuckRun(run, now)) finalized += 1;
  }
  logger.info({ event: 'sandbox.sweeper.completed', metric: { 'sweeper.found': stuck.length } });
  return { found: stuck.length, finalized };
}

async function finalizeStuckRun(run: Run, now: Date): Promise<boolean> {
  try {
    await finalizeSandboxRun({
      agentId: run.agentId,
      runId: run.id,
      // A wedged run never reported an exit code; the elapsed wall-clock is the
      // best-effort duration (it over-counts, the safe direction for a cap).
      exitCode: null,
      stoppedReason: SWEEP_STOPPED_REASON,
      durationMs: Math.max(0, now.getTime() - new Date(run.createdAt).getTime()),
    });
    logger.warn({
      event: 'sandbox.sweeper.finalized',
      agentId: run.agentId,
      runId: run.id,
    });
    return true;
  } catch (err) {
    logger.error({
      event: 'sandbox.sweeper.finalize_failed',
      agentId: run.agentId,
      runId: run.id,
      err,
    });
    return false;
  }
}

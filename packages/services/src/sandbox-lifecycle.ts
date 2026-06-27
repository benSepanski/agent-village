import { agentRepo, runRepo } from '@agent-village/data';
import type { AgentId, RunId, RunStatus } from '@agent-village/shared';
import { logger } from './logger.js';

export interface FinalizeSandboxRunInput {
  agentId: AgentId;
  runId: RunId;
  /** App container exit code; null if the task stopped before the app reported one. */
  exitCode: number | null;
  /** ECS `stoppedReason`; used to detect timeouts and as the error message. */
  stoppedReason?: string;
  durationMs: number;
}

const TIMEOUT_MARKERS = ['timeout', 'timed out'];

function isTimeout(reason: string): boolean {
  const lower = reason.toLowerCase();
  return TIMEOUT_MARKERS.some((marker) => lower.includes(marker));
}

function terminalStatus(exitCode: number | null, stoppedReason: string): RunStatus {
  if (isTimeout(stoppedReason)) return 'timed_out';
  return exitCode === 0 ? 'ok' : 'error';
}

/**
 * Move a `running` sandbox run to its terminal state when the ECS task stops,
 * and release the agent's concurrent-run slot. The flat sandbox cost was
 * reserved at launch, so spend needs no reconciliation here (actual per-second
 * Fargate cost is a future refinement). A run that can't be found (e.g. the
 * task predates this code) is a no-op.
 */
export async function finalizeSandboxRun(input: FinalizeSandboxRunInput): Promise<void> {
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
  const reason = input.stoppedReason ?? '';
  const status = terminalStatus(input.exitCode, reason);
  await runRepo.patchRun(input.agentId, existing.createdAt, input.runId, {
    status,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    error: status === 'ok' ? null : reason || `exit code ${input.exitCode}`,
  });
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
  });
}

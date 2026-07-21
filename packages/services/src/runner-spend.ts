import { agentRepo, type UserBudgetLeg } from '@agent-village/data';
import { runOutcomeMetric, type Agent, type AgentId, type RunId } from '@agent-village/shared';
import { classifySpendRejection } from './budget.js';
import { logger } from './logger.js';

/**
 * Inline-run reserve/refund lifecycle, split out of runner.ts (file-size
 * bound) — mirrors the equivalent helpers in runner-sandbox.ts for the
 * sandbox-launch path. `userBudget`/`userWindowKey` are threaded through
 * unchanged from the caller so a refund always settles the SAME window the
 * matching reservation used.
 */

export interface SpendLogContext {
  agentId: AgentId;
  runId: RunId;
  traceId: string;
}

/**
 * Reserve `estimateUsd` against the agent's cap and, when `userBudget` is
 * set, the owner's current-month window in the same atomic transaction.
 * Returns false (never throws) on either dual-cap rejection; rethrows
 * anything else.
 */
export async function reserveInlineSpend(
  logCtx: SpendLogContext,
  agent: Agent,
  estimateUsd: number,
  userBudget: UserBudgetLeg | undefined,
): Promise<boolean> {
  try {
    await agentRepo.reserveSpend({
      agentId: agent.id,
      ownerSub: agent.ownerSub,
      estimateUsd,
      ...(userBudget !== undefined ? { userBudget } : {}),
    });
    logger.info({
      event: 'agent.run.spend_reserved',
      ...logCtx,
      metric: { 'spend.reserved_usd': estimateUsd },
    });
    return true;
  } catch (err) {
    const kind = classifySpendRejection(err);
    if (!kind) throw err;
    logger.warn({
      event: kind === 'user_budget' ? 'agent.run.budget_rejected' : 'agent.run.spend_rejected',
      ...logCtx,
      // Real EMF datapoint for the spend-rejected alarm (Phase 3 step 07);
      // RunStatus stays 'spend_limit_exceeded' for both caps per the M3 spec.
      ...runOutcomeMetric('spend_limit_exceeded'),
    });
    return false;
  }
}

/** Release a reservation that was never finalized (e.g. the call setup threw). */
export async function refundInlineReservation(
  logCtx: SpendLogContext,
  agent: Agent,
  estimateUsd: number,
  userWindowKey: string | undefined,
): Promise<void> {
  try {
    await agentRepo.finalizeSpend({
      agentId: agent.id,
      ownerSub: agent.ownerSub,
      deltaUsd: -estimateUsd,
      ...(userWindowKey !== undefined ? { userWindowKey } : {}),
    });
    logger.warn({ event: 'agent.run.spend_refunded', ...logCtx });
  } catch (refundErr) {
    logger.error({ event: 'agent.run.spend_refund_failed', ...logCtx, err: refundErr });
  }
}

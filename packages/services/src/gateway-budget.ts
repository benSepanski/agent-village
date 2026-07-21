import type { UserBudgetLeg } from '@agent-village/data';
import type { Agent, Run } from '@agent-village/shared';
import { resolveUserBudgetLeg } from './budget.js';

export interface CallBudget {
  userBudget: UserBudgetLeg | undefined;
  /** Window key settle should use — mirrors userBudget's presence exactly. */
  settleWindowKey: string | undefined;
}

/**
 * Resolves the gateway's user-budget leg for one call. Split out of
 * anthropic-gateway.ts to stay under the file-size bound
 * (docs/conventions/file-size-bounds.md).
 *
 * Resolved live (the owner may have set/cleared their budget mid-run) but
 * only ONCE per call, then handed back for BOTH reserve and settle to use.
 * Re-resolving independently at settle time would let the two legs disagree
 * — e.g. reserve engages the window leg, the owner clears their budget
 * before the response returns, and a fresh settle-time resolve sees none —
 * refunding/reconciling a window that was never actually reserved against,
 * driving spentUsd negative (M3 verification MAJOR 2).
 */
export async function resolveCallBudget(agent: Agent, run: Run): Promise<CallBudget> {
  // The run's own window — set once at its initial reservation — not a
  // freshly derived "now" window.
  const userWindowKey = run.budgetWindowKey ?? undefined;
  const userBudget = userWindowKey
    ? await resolveUserBudgetLeg(agent.ownerSub, userWindowKey, new Date())
    : undefined;
  return { userBudget, settleWindowKey: userBudget ? userWindowKey : undefined };
}

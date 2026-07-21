import { agentRepo, budgetRepo, userRepo, type UserBudgetLeg } from '@agent-village/data';
import {
  SpendLimitExceededError,
  UserBudgetExceededError,
  UserNotFoundError,
} from '@agent-village/domain';
import type { AgentId, UpdateUserInput, User, UserId } from '@agent-village/shared';
import { logger } from './logger.js';

export interface AgentBudgetFigure {
  agentId: AgentId;
  name: string;
  spendLimitUsd: number;
  spendUsedUsd: number;
}

export interface BudgetStatus {
  /** UTC calendar month the window figures cover, `YYYY-MM`. */
  month: string;
  /** The owner's live monthly cap (PROFILE item), or null when unset. */
  limitUsd: number | null;
  /** Spend accrued against the current-month window; 0 when no budget is set
   *  (the window is only lazily created once a budget exists). Clamped at 0 —
   *  the persisted spentUsd can momentarily dip slightly negative under a
   *  refund/drift race, but that must never surface as negative usage. */
  usedUsd: number;
  /** limitUsd - usedUsd, or null when no cap is set (nothing to be "remaining" of). */
  remainingUsd: number | null;
  /** Per-agent spend figures, for the same ownership-scoped caller. */
  agents: AgentBudgetFigure[];
}

/**
 * The caller's current-month budget status: the live user cap, the window
 * accumulator, and each of their agents' own spend figures. Owner-scoped —
 * `ownerSub` always comes from the caller's own JWT claims at the handler.
 */
export async function getBudgetStatus(
  ownerSub: UserId,
  now: Date = new Date(),
): Promise<BudgetStatus> {
  const profile = await userRepo.getProfile(ownerSub);
  if (!profile) throw new UserNotFoundError(ownerSub);
  const [window, agents] = await Promise.all([
    budgetRepo.getWindow(ownerSub, now),
    agentRepo.listMyAgents(ownerSub),
  ]);
  const limitUsd = profile.userMonthlyBudgetUsd ?? null;
  const usedUsd = Math.max(0, window?.spentUsd ?? 0);
  return {
    month: now.toISOString().slice(0, 7),
    limitUsd,
    usedUsd,
    remainingUsd: limitUsd === null ? null : limitUsd - usedUsd,
    agents: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      spendLimitUsd: a.spendLimitUsd,
      spendUsedUsd: a.spendUsedUsd,
    })),
  };
}

/**
 * Set, change, or clear the caller's live monthly budget cap. `null` clears it
 * (REMOVE); omitting the field entirely is a no-op that just returns the
 * current profile. Lowering the cap takes effect on the very next reservation
 * — there is no retroactive reset of the current window.
 */
export async function updateUserBudget(ownerSub: UserId, input: UpdateUserInput): Promise<User> {
  if (input.userMonthlyBudgetUsd === undefined) {
    const profile = await userRepo.getProfile(ownerSub);
    if (!profile) throw new UserNotFoundError(ownerSub);
    return profile;
  }
  const updated = await userRepo.updateProfile({
    cognitoSub: ownerSub,
    userMonthlyBudgetUsd: input.userMonthlyBudgetUsd,
  });
  logger.info({ event: 'user.budget_updated', userId: ownerSub });
  return updated;
}

/**
 * Which cap rejected a spend reservation, or null when `err` was not a spend
 * rejection at all (callers must rethrow in that case — this only classifies
 * the two dual-cap outcomes, never swallows an unrelated error).
 */
export type SpendRejectionKind = 'agent_cap' | 'user_budget' | null;

export function classifySpendRejection(err: unknown): SpendRejectionKind {
  if (err instanceof UserBudgetExceededError) return 'user_budget';
  if (err instanceof SpendLimitExceededError) return 'agent_cap';
  return null;
}

/**
 * Build the `UserBudgetLeg` a reservation should carry against `windowKey`, or
 * `undefined` when the owner has no live monthly budget right now — its
 * absence is what keeps a reservation on the legacy single-item path
 * (agentRepo.reserveSpend/finalizeSpend), byte-for-byte, for budget-less
 * owners. `windowKey` is supplied by the caller rather than derived here: a
 * fresh `userBudgetSk(now)` when starting a new run (runner/runner-sandbox),
 * or the run's own persisted `budgetWindowKey` for a mid-run gateway
 * reservation — so a reservation never lands in a window different from the
 * one settlement will read back off the run record.
 */
export async function resolveUserBudgetLeg(
  ownerSub: UserId,
  windowKey: string,
  now: Date,
): Promise<UserBudgetLeg | undefined> {
  const profile = await userRepo.getProfile(ownerSub);
  const limitUsd = profile?.userMonthlyBudgetUsd;
  if (limitUsd === undefined) return undefined;
  return { windowKey, limitUsd, now: now.toISOString() };
}

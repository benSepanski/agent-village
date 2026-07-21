import { agentRepo, budgetRepo, runRepo, userRepo } from '@agent-village/data';
import { budgetDriftMetric } from '@agent-village/shared';
import type { Agent, User } from '@agent-village/shared';
import { logger } from './logger.js';

/**
 * Report-only drift-reconciliation sweep (M3 spec section on the drift job):
 * recomputes each agent's lifetime spend accumulator and each budgeted user's
 * current- AND immediately-preceding-month window accumulators (a
 * settle-lag grace period for calls pinned to a prior month's window that
 * settle after the calendar rolls over) straight from run records, and emits
 * an EMF gauge of the absolute difference from what's persisted. Never
 * writes a correction — mirrors the stuck-run sweeper's pattern
 * (services/sandbox-sweeper.ts) of a standalone scheduled pass a Lambda
 * handler wraps and rethrows from.
 */

/** Default alarm-worthy drift, overridable via AV_BUDGET_DRIFT_THRESHOLD_USD. */
const DEFAULT_DRIFT_THRESHOLD_USD = 0.5;

export function driftThresholdUsd(): number {
  const raw = process.env['AV_BUDGET_DRIFT_THRESHOLD_USD'];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DRIFT_THRESHOLD_USD;
}

export interface BudgetDriftResult {
  agentsChecked: number;
  usersChecked: number;
  /** Largest absolute drift observed this pass, across every scope. */
  maxDriftUsd: number;
  /** Scopes whose drift exceeded the threshold. */
  detected: number;
}

interface ScopeDrift {
  driftUsd: number;
  exceeded: boolean;
}

interface ReportDriftInput {
  scope: 'agent' | 'user';
  id: string;
  persistedUsd: number;
  expectedUsd: number;
  thresholdUsd: number;
}

/** Logs the recompute (always) and the alarm-worthy-drift warning (when it fires). */
function reportDrift(input: ReportDriftInput): ScopeDrift {
  const { scope, id, persistedUsd, expectedUsd, thresholdUsd } = input;
  const driftUsd = persistedUsd - expectedUsd;
  logger.info({
    event: 'budget.drift.checked',
    scope,
    id,
    metric: { 'budget.persisted_usd': persistedUsd, 'budget.expected_usd': expectedUsd },
    ...budgetDriftMetric(driftUsd),
  });
  const exceeded = Math.abs(driftUsd) > thresholdUsd;
  if (exceeded) {
    logger.warn({
      event: 'budget.drift.detected',
      scope,
      id,
      metric: { 'budget.drift_usd': driftUsd },
    });
  }
  return { driftUsd, exceeded };
}

/** Recomputed-vs-persisted drift for one agent's lifetime `spendUsedUsd`. */
async function checkAgentDrift(agent: Agent, thresholdUsd: number): Promise<ScopeDrift> {
  const { costUsd, inFlightReservedUsd } = await runRepo.sumAgentLifetimeCost(agent.id);
  return reportDrift({
    scope: 'agent',
    id: agent.id,
    persistedUsd: agent.spendUsedUsd,
    expectedUsd: costUsd + inFlightReservedUsd,
    thresholdUsd,
  });
}

/** The first instant of the UTC calendar month immediately before `date`'s. */
function previousMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

/**
 * Recomputed-vs-persisted drift for one budgeted user's window `spentUsd` in
 * the UTC calendar month `monthDate` falls in, or null for a user with no
 * live cap (nothing to reconcile — the window is only lazily created once a
 * budget exists).
 */
async function checkUserDrift(
  user: User,
  monthDate: Date,
  thresholdUsd: number,
): Promise<ScopeDrift | null> {
  if (user.userMonthlyBudgetUsd === undefined) return null;
  const [window, summary] = await Promise.all([
    budgetRepo.getWindow(user.cognitoSub, monthDate),
    runRepo.sumUserMonthCost(user.cognitoSub, monthDate),
  ]);
  return reportDrift({
    scope: 'user',
    id: user.cognitoSub,
    persistedUsd: window?.spentUsd ?? 0,
    expectedUsd: summary.costUsd + summary.inFlightReservedUsd,
    thresholdUsd,
  });
}

interface DriftTally {
  maxDriftUsd: number;
  detected: number;
}

function foldDrift(scopes: ReadonlyArray<ScopeDrift | null>, acc: DriftTally): DriftTally {
  let { maxDriftUsd, detected } = acc;
  for (const s of scopes) {
    if (!s) continue;
    maxDriftUsd = Math.max(maxDriftUsd, Math.abs(s.driftUsd));
    if (s.exceeded) detected += 1;
  }
  return { maxDriftUsd, detected };
}

async function accumulateAgentDrift(agents: Agent[], thresholdUsd: number): Promise<DriftTally> {
  let acc: DriftTally = { maxDriftUsd: 0, detected: 0 };
  for (const agent of agents) {
    acc = foldDrift([await checkAgentDrift(agent, thresholdUsd)], acc);
  }
  return acc;
}

/**
 * Also reconciles the immediately-preceding month's window per user: a run
 * pinned to month A's window (its budgetWindowKey) can still settle in month
 * B after the calendar rolls over, so a scope that looked clean at month A's
 * own sweep can still drift afterward. Checking only `now` would leave that
 * settle-lag window permanently unchecked once the month advances (M3
 * verification MINOR 4).
 */
async function accumulateUserDrift(
  users: User[],
  now: Date,
  thresholdUsd: number,
): Promise<DriftTally> {
  const priorMonth = previousMonthStart(now);
  let acc: DriftTally = { maxDriftUsd: 0, detected: 0 };
  for (const user of users) {
    const scopes = [
      await checkUserDrift(user, now, thresholdUsd),
      await checkUserDrift(user, priorMonth, thresholdUsd),
    ];
    acc = foldDrift(scopes, acc);
  }
  return acc;
}

/**
 * One drift-reconciliation pass over every agent and every budgeted user.
 * Report-only: never writes a correction, only alarms (via the caller's EMF
 * `Maximum` metric) when a scope's drift exceeds `thresholdUsd`.
 */
export async function checkBudgetDrift(
  now: Date = new Date(),
  thresholdUsd: number = driftThresholdUsd(),
): Promise<BudgetDriftResult> {
  const [agents, users] = await Promise.all([
    agentRepo.listAllAgents(),
    userRepo.listAllProfiles(),
  ]);
  const agentDrift = await accumulateAgentDrift(agents, thresholdUsd);
  const userDrift = await accumulateUserDrift(users, now, thresholdUsd);
  const result: BudgetDriftResult = {
    agentsChecked: agents.length,
    usersChecked: users.length,
    maxDriftUsd: Math.max(agentDrift.maxDriftUsd, userDrift.maxDriftUsd),
    detected: agentDrift.detected + userDrift.detected,
  };
  logger.info({
    event: 'budget.drift.completed',
    metric: {
      'drift.agents_checked': result.agentsChecked,
      'drift.users_checked': result.usersChecked,
      'drift.detected': result.detected,
    },
  });
  return result;
}

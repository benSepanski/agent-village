import { runRepo } from '@agent-village/data';
import type { AgentId, Run, RunId, UserId } from '@agent-village/shared';
import { getMyAgent } from './agent.js';

/** Owner-scoped read paths over run records (list, get, month-to-date spend). */

export async function listForAgent(ownerSub: UserId, agentId: AgentId): Promise<Run[]> {
  await getMyAgent(ownerSub, agentId);
  return runRepo.listForAgent(agentId);
}

export async function getRun(
  ownerSub: UserId,
  agentId: AgentId,
  runId: RunId,
): Promise<Run | null> {
  await getMyAgent(ownerSub, agentId);
  return runRepo.getOne(agentId, runId);
}

export interface MonthToDateSpend {
  /** UTC calendar month the summary covers, `YYYY-MM`. */
  month: string;
  costUsd: number;
  runCount: number;
}

/**
 * Month-to-date spend for one agent, summed live from the run records created
 * in the current UTC month — run sort keys are time-ordered, so one
 * key-condition range query suffices (no accumulator table, no reset cron).
 */
export async function monthToDateSpend(
  ownerSub: UserId,
  agentId: AgentId,
  now: Date = new Date(),
): Promise<MonthToDateSpend> {
  await getMyAgent(ownerSub, agentId);
  const { costUsd, runCount } = await runRepo.sumMonthCost(agentId, now);
  return { month: now.toISOString().slice(0, 7), costUsd, runCount };
}

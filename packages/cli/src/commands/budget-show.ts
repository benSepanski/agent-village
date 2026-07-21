import { client } from '../client.js';
import { kv, table } from '../format.js';

interface AgentBudgetFigure {
  agentId: string;
  name: string;
  spendLimitUsd: number;
  spendUsedUsd: number;
}

interface BudgetStatus {
  month: string;
  limitUsd: number | null;
  usedUsd: number;
  remainingUsd: number | null;
  agents: AgentBudgetFigure[];
}

/** GET /me/budget: the caller's current-month cap, usage, and per-agent breakdown. */
export async function budgetShow(): Promise<string> {
  const c = await client();
  const status = await c.get<BudgetStatus>('/me/budget');
  const meta = kv([
    ['month', status.month],
    ['limit', status.limitUsd === null ? '(none set)' : `$${status.limitUsd.toFixed(2)}`],
    ['used', `$${status.usedUsd.toFixed(4)}`],
    ['remaining', status.remainingUsd === null ? '—' : `$${status.remainingUsd.toFixed(4)}`],
  ]);
  const agentsTable = table(
    ['agentId', 'name', 'spend'],
    status.agents.map((a) => [
      a.agentId,
      a.name,
      `$${a.spendUsedUsd.toFixed(4)} / $${a.spendLimitUsd.toFixed(2)}`,
    ]),
  );
  return `${meta}\n\nagents\n${agentsTable}`;
}

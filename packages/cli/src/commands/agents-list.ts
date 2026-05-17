import { client } from '../client.js';
import { statusColor, table } from '../format.js';

interface AgentRow {
  id: string;
  name: string;
  status: string;
  schedule: string | null;
  spendUsedUsd: number;
  spendLimitUsd: number;
}

export async function agentsList(): Promise<string> {
  const c = await client();
  const res = await c.get<{ agents: AgentRow[] }>('/agents');
  const rows = res.agents.map((a) => [
    a.id,
    a.name,
    statusColor(a.status),
    a.schedule ?? '—',
    `$${a.spendUsedUsd.toFixed(4)} / $${a.spendLimitUsd.toFixed(2)}`,
  ]);
  return table(['id', 'name', 'status', 'schedule', 'spend'], rows);
}

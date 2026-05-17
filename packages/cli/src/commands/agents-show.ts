import { client } from '../client.js';
import { kv, statusColor, table } from '../format.js';

interface Agent {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  schedule: string | null;
  spendLimitUsd: number;
  spendUsedUsd: number;
  status: string;
  createdAt: string;
}

interface Run {
  id: string;
  status: string;
  costUsd: number;
  durationMs: number;
  createdAt: string;
}

export async function agentsShow(agentId: string): Promise<string> {
  const c = await client();
  const agent = await c.get<Agent>(`/agents/${agentId}`);
  const { runs } = await c.get<{ runs: Run[] }>(`/agents/${agentId}/runs`);
  const meta = kv([
    ['id', agent.id],
    ['name', agent.name],
    ['model', agent.model],
    ['schedule', agent.schedule ?? '—'],
    ['status', statusColor(agent.status)],
    ['spend', `$${agent.spendUsedUsd.toFixed(4)} / $${agent.spendLimitUsd.toFixed(2)}`],
    ['createdAt', agent.createdAt],
  ]);
  const runsTable = table(
    ['runId', 'status', 'cost', 'durationMs', 'createdAt'],
    runs
      .slice(0, 10)
      .map((r) => [
        r.id,
        statusColor(r.status),
        `$${r.costUsd.toFixed(4)}`,
        String(r.durationMs),
        r.createdAt,
      ]),
  );
  return `${meta}\n\nrecent runs\n${runsTable}`;
}

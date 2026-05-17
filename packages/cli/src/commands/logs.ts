import { client } from '../client.js';
import { kv, statusColor } from '../format.js';

interface RunDetail {
  id: string;
  agentId: string;
  status: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  output: string | null;
  error: string | null;
  traceId: string;
  createdAt: string;
}

export async function logs(agentId: string, runId: string): Promise<string> {
  const c = await client();
  const run = await c.get<RunDetail>(`/agents/${agentId}/runs/${runId}`);
  const meta = kv([
    ['runId', run.id],
    ['agentId', run.agentId],
    ['status', statusColor(run.status)],
    ['cost', `$${run.costUsd.toFixed(4)}`],
    ['tokens', `in=${run.tokensIn} out=${run.tokensOut}`],
    ['duration', `${run.durationMs}ms`],
    ['traceId', run.traceId],
    ['createdAt', run.createdAt],
  ]);
  const body = run.error ? `error: ${run.error}` : `output:\n${run.output ?? '(empty)'}`;
  return `${meta}\n\n${body}`;
}

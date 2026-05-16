import { client } from '../client.js';
import { kv, statusColor } from '../format.js';

interface RunResult {
  runId: string;
  status: string;
}

export interface RunOptions {
  dryRun?: boolean;
}

export async function run(agentId: string, opts: RunOptions = {}): Promise<string> {
  const c = await client();
  const body = opts.dryRun === true ? { dryRun: true } : {};
  const result = await c.post<RunResult>(`/agents/${agentId}/run-now`, body);
  return kv([
    ['agentId', agentId],
    ['runId', result.runId],
    ['status', statusColor(result.status)],
  ]);
}

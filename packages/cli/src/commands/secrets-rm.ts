import { client } from '../client.js';
import { kv } from '../format.js';

export async function secretsRm(agentId: string, name: string): Promise<string> {
  const c = await client();
  await c.del<undefined>(`/agents/${agentId}/secrets/${name}`);
  return kv([
    ['agentId', agentId],
    ['secret', name],
    ['action', 'deleted'],
  ]);
}

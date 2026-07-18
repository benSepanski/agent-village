import { client } from '../client.js';
import { table } from '../format.js';

export async function secretsList(agentId: string): Promise<string> {
  const c = await client();
  const res = await c.get<{ secrets: string[] }>(`/agents/${agentId}/secrets`);
  if (res.secrets.length === 0) return 'no secrets stored for this agent';
  return table(
    ['name'],
    res.secrets.map((name) => [name]),
  );
}

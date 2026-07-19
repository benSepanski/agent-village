import type { ListWorkspaceResponse } from '@agent-village/shared';
import { client } from '../client.js';
import { table } from '../format.js';

export async function workspaceLs(agentId: string): Promise<string> {
  const c = await client();
  const res = await c.get<ListWorkspaceResponse>(`/agents/${agentId}/workspace`);
  if (res.entries.length === 0) return 'workspace is empty';
  const rows = res.entries.map((e) => [e.path, String(e.size), e.lastModified]);
  const body = table(['path', 'size', 'lastModified'], rows);
  return res.truncated
    ? `${body}\n\n(truncated: more entries exist than this listing page shows)`
    : body;
}

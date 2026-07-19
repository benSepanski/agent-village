import { client } from '../client.js';
import { kv } from '../format.js';
import { deleteFile, lookupPresigned, presignBatches } from './workspace-transfer.js';

export async function workspaceRm(agentId: string, path: string): Promise<string> {
  const c = await client();
  const presigned = await presignBatches(c, agentId, [{ path, op: 'delete' }]);
  const url = lookupPresigned(presigned, 'delete', path);
  await deleteFile(url.url, path);
  return kv([
    ['agentId', agentId],
    ['path', path],
    ['action', 'deleted'],
  ]);
}

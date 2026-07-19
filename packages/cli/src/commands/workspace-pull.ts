import type { ListWorkspaceResponse, WorkspaceEntry } from '@agent-village/shared';
import { client } from '../client.js';
import {
  getFile,
  lookupPresigned,
  presignBatches,
  safeDestPath,
  transferSummary,
} from './workspace-transfer.js';

export interface WorkspacePullOptions {
  prefix?: string | undefined;
}

function filterByPrefix(entries: WorkspaceEntry[], prefix: string | undefined): WorkspaceEntry[] {
  if (!prefix) return entries;
  return entries.filter((e) => e.path === prefix || e.path.startsWith(`${prefix}/`));
}

const TRUNCATED_NOTE = '(truncated: only the first 1000 files were listed and pulled)';

export async function workspacePull(
  agentId: string,
  destDir = '.',
  opts: WorkspacePullOptions = {},
): Promise<string> {
  const c = await client();
  const listing = await c.get<ListWorkspaceResponse>(`/agents/${agentId}/workspace`);
  const entries = filterByPrefix(listing.entries, opts.prefix);
  if (entries.length === 0) {
    const empty = 'nothing to pull';
    return listing.truncated ? `${empty}\n\n${TRUNCATED_NOTE}` : empty;
  }
  const presigned = await presignBatches(
    c,
    agentId,
    entries.map((e) => ({ path: e.path, op: 'get' as const })),
  );
  const downloaded: Array<{ path: string; size: number }> = [];
  for (const e of entries) {
    const url = lookupPresigned(presigned, 'get', e.path);
    const dest = safeDestPath(destDir, e.path);
    const size = await getFile(url.url, dest, e.path);
    downloaded.push({ path: e.path, size });
  }
  const summary = transferSummary(downloaded);
  return listing.truncated ? `${summary}\n\n${TRUNCATED_NOTE}` : summary;
}

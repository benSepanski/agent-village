import { client } from '../client.js';
import {
  lookupPresigned,
  presignBatches,
  putFile,
  transferSummary,
  walkLocalPath,
} from './workspace-transfer.js';

export interface WorkspacePushOptions {
  dest?: string | undefined;
}

export async function workspacePush(
  agentId: string,
  localPath: string,
  opts: WorkspacePushOptions = {},
): Promise<string> {
  const files = await walkLocalPath(localPath, opts.dest);
  if (files.length === 0) return 'nothing to push';
  const c = await client();
  const presigned = await presignBatches(
    c,
    agentId,
    files.map((f) => ({ path: f.workspacePath, op: 'put' as const })),
  );
  const uploaded: Array<{ path: string; size: number }> = [];
  for (const f of files) {
    const url = lookupPresigned(presigned, 'put', f.workspacePath);
    const size = await putFile(url.url, f.localPath, f.workspacePath);
    uploaded.push({ path: f.workspacePath, size });
  }
  return transferSummary(uploaded);
}

import { agentRepo, workspaceS3 } from '@agent-village/data';
import { AgentNotFoundError } from '@agent-village/domain';
import {
  ListWorkspaceResponse,
  PresignWorkspaceResponse,
  workspacePrefix,
  type AgentId,
  type PresignWorkspaceInput,
  type UserId,
} from '@agent-village/shared';
import { logger } from './logger.js';

/** Matches the data-layer presign default and the docs/phases spec (15 minutes). */
const PRESIGN_EXPIRES_SECONDS = 900;

/**
 * Every operation proves ownership by loading the agent under the caller's
 * own partition key — deriving the workspace prefix from the agentId alone
 * would let any authenticated user address any agent's S3 prefix.
 */
async function assertAgentOwned(ownerSub: UserId, agentId: AgentId): Promise<void> {
  const agent = await agentRepo.getAgent(ownerSub, agentId);
  if (!agent) throw new AgentNotFoundError(agentId);
}

function getWorkspaceBucket(): string {
  const bucket = process.env['AV_WORKSPACE_BUCKET'];
  if (!bucket) throw new Error('AV_WORKSPACE_BUCKET environment variable is required');
  return bucket;
}

/** List one page (MaxKeys 1000) of the agent's durable workspace, prefix stripped to relative paths. */
export async function listWorkspace(
  ownerSub: UserId,
  agentId: AgentId,
): Promise<ListWorkspaceResponse> {
  await assertAgentOwned(ownerSub, agentId);
  const prefix = workspacePrefix(ownerSub, agentId);
  const page = await workspaceS3.listWorkspaceObjects(getWorkspaceBucket(), prefix);
  const entries = page.entries.map((obj) => ({
    path: obj.key.slice(prefix.length),
    size: obj.size,
    lastModified: obj.lastModified,
  }));
  logger.info({
    event: 'agent.workspace.listed',
    agentId,
    userId: ownerSub,
    metric: { count: entries.length },
  });
  return ListWorkspaceResponse.parse({ entries, truncated: page.truncated });
}

async function presignOne(
  bucket: string,
  prefix: string,
  expiresAt: string,
  file: PresignWorkspaceInput['files'][number],
): Promise<PresignWorkspaceResponse['urls'][number]> {
  const url = await workspaceS3.presignWorkspaceUrl(
    bucket,
    `${prefix}${file.path}`,
    file.op,
    PRESIGN_EXPIRES_SECONDS,
  );
  return { path: file.path, op: file.op, url, expiresAt };
}

/** Batch-presign GET/PUT/DELETE URLs, each scoped to exactly one key under this agent's prefix. */
export async function presignWorkspace(
  ownerSub: UserId,
  agentId: AgentId,
  input: PresignWorkspaceInput,
): Promise<PresignWorkspaceResponse> {
  await assertAgentOwned(ownerSub, agentId);
  const bucket = getWorkspaceBucket();
  const prefix = workspacePrefix(ownerSub, agentId);
  const expiresAt = new Date(Date.now() + PRESIGN_EXPIRES_SECONDS * 1000).toISOString();
  const urls = await Promise.all(
    input.files.map((file) => presignOne(bucket, prefix, expiresAt, file)),
  );
  logger.info({
    event: 'agent.workspace.presigned',
    agentId,
    userId: ownerSub,
    metric: { count: urls.length },
  });
  return PresignWorkspaceResponse.parse({ urls });
}

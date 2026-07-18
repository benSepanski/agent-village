import { agentRepo, grantSecrets } from '@agent-village/data';
import { AgentNotFoundError, SecretPendingDeletionError } from '@agent-village/domain';
import {
  SecretLeafName,
  isReservedSecretLeaf,
  type AgentId,
  type UserId,
} from '@agent-village/shared';
import { logger } from './logger.js';

const ENV = process.env['AV_ENV'] ?? 'dev';

export interface StoredAgentSecret {
  name: string;
  arn: string;
}

/**
 * Every operation proves ownership by loading the agent under the caller's
 * own partition key — deriving the secret name from the agentId alone would
 * let any authenticated user address any agent's prefix.
 */
async function assertAgentOwned(ownerSub: UserId, agentId: AgentId): Promise<void> {
  const agent = await agentRepo.getAgent(ownerSub, agentId);
  if (!agent) throw new AgentNotFoundError(agentId);
}

/**
 * Kebab-case leaf validation, including the reserved-leaf refusal: without it
 * a user could overwrite the platform's `anthropic-key` and bypass the
 * metering gateway (ADR 0004). Throws ZodError → 400 at the API boundary.
 */
function parseLeaf(name: string): string {
  return SecretLeafName.parse(name);
}

/** Secrets Manager rejects writes/deletes on a secret already scheduled for deletion. */
function isScheduledForDeletion(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === 'InvalidRequestException' &&
    err.message.includes('scheduled for deletion')
  );
}

async function withDeletionGuard<T>(
  agentId: AgentId,
  leaf: string,
  op: () => Promise<T>,
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (isScheduledForDeletion(err)) throw new SecretPendingDeletionError(agentId, leaf);
    throw err;
  }
}

/** Create or overwrite one user-managed secret. Never logs or returns the value. */
export async function setAgentSecret(
  ownerSub: UserId,
  agentId: AgentId,
  name: string,
  value: string,
): Promise<StoredAgentSecret> {
  await assertAgentOwned(ownerSub, agentId);
  const leaf = parseLeaf(name);
  const stored = await withDeletionGuard(agentId, leaf, () =>
    grantSecrets.storeAgentSecret(agentId, leaf, value, ENV),
  );
  // Name and ARN only — the plaintext value must never reach a log or response.
  logger.info({ event: 'agent.secret.stored', agentId, userId: ownerSub, secretName: leaf });
  return { name: leaf, arn: stored.arn };
}

/**
 * Leaf names of the agent's user-managed secrets. Platform-managed leaves
 * (`anthropic-key`, …) live under the same prefix but are not settable or
 * deletable through this API, so they are hidden from the listing too.
 */
export async function listAgentSecrets(ownerSub: UserId, agentId: AgentId): Promise<string[]> {
  await assertAgentOwned(ownerSub, agentId);
  const leaves = await grantSecrets.listAgentSecrets(agentId, ENV);
  return leaves.filter((leaf) => !isReservedSecretLeaf(leaf));
}

/** Force-delete one user-managed secret (no recovery window). */
export async function deleteAgentSecret(
  ownerSub: UserId,
  agentId: AgentId,
  name: string,
): Promise<void> {
  await assertAgentOwned(ownerSub, agentId);
  const leaf = parseLeaf(name);
  await withDeletionGuard(agentId, leaf, () =>
    grantSecrets.deleteAgentSecret(grantSecrets.agentSecretName(agentId, leaf, ENV)),
  );
  logger.info({ event: 'agent.secret.deleted', agentId, userId: ownerSub, secretName: leaf });
}

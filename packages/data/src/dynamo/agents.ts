import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  AgentSchema,
  type Agent,
  type AgentId,
  type AgentStatus,
  type AnthropicModel,
  type ApplicationManifest,
  type RunId,
  type SandboxTaskDefCache,
  type UserId,
} from '@agent-village/shared';
import {
  AgentNotFoundError,
  AgentRunInProgressError,
  SpendLimitExceededError,
} from '@agent-village/domain';
import { getConfig, getDocumentClient } from './client.js';
import {
  AGENT_GSI1SK_META,
  AGENT_SK_PREFIX,
  GSI1_NAME,
  agentGsi1pk,
  agentSk,
  userPk,
} from './keys.js';
import { isConditionalCheckFailed } from './errors-map.js';

export type AgentPatch = Partial<{
  name: string;
  model: AnthropicModel;
  systemPrompt: string;
  schedule: string | null;
  spendLimitUsd: number;
  anthropicSecretArn: string;
  status: AgentStatus;
  manifest: ApplicationManifest | null;
  activeRunId: string | null;
  // Launcher-only: caches the per-image task definition registered for a
  // custom manifest.image. User patches never carry it (buildPatch whitelist).
  sandboxTaskDef: SandboxTaskDefCache | null;
}>;

interface AgentItem {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
}

function marshal(agent: Agent): AgentItem & Agent {
  return {
    pk: userPk(agent.ownerSub),
    sk: agentSk(agent.id),
    gsi1pk: agentGsi1pk(agent.id),
    gsi1sk: AGENT_GSI1SK_META,
    ...agent,
  };
}

export async function listMyAgents(cognitoSub: UserId): Promise<Agent[]> {
  const { tableName } = getConfig();
  const res = await getDocumentClient().send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': userPk(cognitoSub),
        ':skPrefix': AGENT_SK_PREFIX,
      },
    }),
  );
  return (res.Items ?? []).map((item) => AgentSchema.parse(item));
}

export async function getAgent(cognitoSub: UserId, agentId: AgentId): Promise<Agent | null> {
  const { tableName } = getConfig();
  const res = await getDocumentClient().send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: userPk(cognitoSub), sk: agentSk(agentId) },
    }),
  );
  return res.Item ? AgentSchema.parse(res.Item) : null;
}

export async function getAgentById(agentId: AgentId): Promise<Agent | null> {
  const { tableName } = getConfig();
  const res = await getDocumentClient().send(
    new QueryCommand({
      TableName: tableName,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk = :sk',
      ExpressionAttributeValues: {
        ':pk': agentGsi1pk(agentId),
        ':sk': AGENT_GSI1SK_META,
      },
      Limit: 1,
    }),
  );
  const item = (res.Items ?? [])[0];
  return item ? AgentSchema.parse(item) : null;
}

export async function createAgent(agent: Agent): Promise<void> {
  const validated = AgentSchema.parse(agent);
  const { tableName } = getConfig();
  await getDocumentClient().send(
    new PutCommand({
      TableName: tableName,
      Item: marshal(validated),
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
}

interface UpdateInput {
  agentId: AgentId;
  ownerSub: UserId;
  patch: AgentPatch;
  now?: string;
}

interface BuiltUpdate {
  expression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
}

function buildPatchUpdate(patch: AgentPatch, now: string): BuiltUpdate {
  const sets: string[] = [];
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': now };
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue;
    sets.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = val;
  }
  sets.push('#updatedAt = :updatedAt');
  return { expression: `SET ${sets.join(', ')}`, names, values };
}

export async function updateAgent(input: UpdateInput): Promise<Agent> {
  const { tableName } = getConfig();
  const now = input.now ?? new Date().toISOString();
  const built = buildPatchUpdate(input.patch, now);
  try {
    const res = await getDocumentClient().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: userPk(input.ownerSub), sk: agentSk(input.agentId) },
        UpdateExpression: built.expression,
        ExpressionAttributeNames: built.names,
        ExpressionAttributeValues: built.values,
        ConditionExpression: 'attribute_exists(pk)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return AgentSchema.parse(res.Attributes);
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new AgentNotFoundError(input.agentId);
    throw err;
  }
}

export async function deleteAgent(cognitoSub: UserId, agentId: AgentId): Promise<void> {
  const { tableName } = getConfig();
  try {
    await getDocumentClient().send(
      new DeleteCommand({
        TableName: tableName,
        Key: { pk: userPk(cognitoSub), sk: agentSk(agentId) },
        ConditionExpression: 'attribute_exists(pk)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new AgentNotFoundError(agentId);
    throw err;
  }
}

interface ReserveSpendInput {
  agentId: AgentId;
  ownerSub: UserId;
  estimateUsd: number;
}

export async function reserveSpend(input: ReserveSpendInput): Promise<void> {
  const { tableName } = getConfig();
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: userPk(input.ownerSub), sk: agentSk(input.agentId) },
        UpdateExpression: 'ADD spendUsedUsd :estimate',
        ConditionExpression: 'spendUsedUsd + :estimate <= spendLimitUsd',
        ExpressionAttributeValues: { ':estimate': input.estimateUsd },
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      const item = err.Item ?? {};
      throw new SpendLimitExceededError({
        agentId: input.agentId,
        spendLimitUsd: Number(item['spendLimitUsd'] ?? 0),
        spendUsedUsd: Number(item['spendUsedUsd'] ?? 0),
        estimateUsd: input.estimateUsd,
      });
    }
    throw err;
  }
}

interface FinalizeSpendInput {
  agentId: AgentId;
  ownerSub: UserId;
  deltaUsd: number;
}

export async function finalizeSpend(input: FinalizeSpendInput): Promise<void> {
  const { tableName } = getConfig();
  await getDocumentClient().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: userPk(input.ownerSub), sk: agentSk(input.agentId) },
      UpdateExpression: 'ADD spendUsedUsd :delta',
      ExpressionAttributeValues: { ':delta': input.deltaUsd },
    }),
  );
}

interface ActiveRunInput {
  agentId: AgentId;
  ownerSub: UserId;
  runId: RunId;
}

/**
 * Claim the agent's single concurrent-run slot for `runId`. Fails if a run is
 * already in flight (ADR 0002: one run at a time per agent) — the conditional
 * write makes the check-and-set atomic across overlapping schedule firings.
 */
export async function acquireActiveRun(input: ActiveRunInput): Promise<void> {
  const { tableName } = getConfig();
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: userPk(input.ownerSub), sk: agentSk(input.agentId) },
        UpdateExpression: 'SET activeRunId = :runId',
        ConditionExpression:
          'attribute_exists(pk) AND (attribute_not_exists(activeRunId) OR activeRunId = :null)',
        ExpressionAttributeValues: { ':runId': input.runId, ':null': null },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new AgentRunInProgressError(input.agentId);
    throw err;
  }
}

/**
 * Release the concurrent-run slot, but only if it still belongs to `runId`. A
 * stale release (the slot was already cleared or reclaimed by a newer run) is a
 * no-op, never a clobber.
 */
export async function releaseActiveRun(input: ActiveRunInput): Promise<void> {
  const { tableName } = getConfig();
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: userPk(input.ownerSub), sk: agentSk(input.agentId) },
        UpdateExpression: 'SET activeRunId = :null',
        ConditionExpression: 'activeRunId = :runId',
        ExpressionAttributeValues: { ':runId': input.runId, ':null': null },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return;
    throw err;
  }
}

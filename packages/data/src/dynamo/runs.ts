import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { RunSchema, type Run, type AgentId, type RunId } from '@agent-village/shared';
import { getConfig, getDocumentClient } from './client.js';
import { RUN_SK_PREFIX, agentPk, runGsi1sk, runSk, userPk } from './keys.js';

const DEFAULT_LIMIT = 50;

interface RunItem {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
}

function marshal(run: Run): RunItem & Run {
  return {
    pk: agentPk(run.agentId),
    sk: runSk(run.createdAt, run.id),
    gsi1pk: userPk(run.ownerSub),
    gsi1sk: runGsi1sk(run.createdAt),
    ...run,
  };
}

export async function append(run: Run): Promise<void> {
  const validated = RunSchema.parse(run);
  const { tableName } = getConfig();
  await getDocumentClient().send(
    new PutCommand({
      TableName: tableName,
      Item: marshal(validated),
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
}

export async function listForAgent(
  agentId: AgentId,
  options: { limit?: number } = {},
): Promise<Run[]> {
  const { tableName } = getConfig();
  const res = await getDocumentClient().send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': agentPk(agentId),
        ':skPrefix': RUN_SK_PREFIX,
      },
      Limit: options.limit ?? DEFAULT_LIMIT,
      ScanIndexForward: false,
    }),
  );
  return (res.Items ?? []).map((item) => RunSchema.parse(item));
}

export async function getOne(agentId: AgentId, runId: RunId): Promise<Run | null> {
  const { tableName } = getConfig();
  const res = await getDocumentClient().send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': agentPk(agentId),
        ':skPrefix': RUN_SK_PREFIX,
      },
      ScanIndexForward: false,
    }),
  );
  const match = (res.Items ?? []).find((item) => item['id'] === runId);
  return match ? RunSchema.parse(match) : null;
}

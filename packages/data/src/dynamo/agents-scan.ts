import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { AgentSchema, type Agent } from '@agent-village/shared';
import { getConfig, getDocumentClient } from './client.js';
import { AGENT_SK_PREFIX } from './keys.js';

/**
 * Every agent in the table, regardless of owner. Used by the report-only
 * budget-drift job to recompute each agent's lifetime spend accumulator; not
 * on any user-facing request path. Paginates — personal scale keeps this
 * cheap, but a status/owner GSI would be the efficient alternative if agent
 * volume ever grows.
 */
export async function listAllAgents(): Promise<Agent[]> {
  const { tableName } = getConfig();
  const client = getDocumentClient();
  const agents: Agent[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: { ':skPrefix': AGENT_SK_PREFIX },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) agents.push(AgentSchema.parse(item));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return agents;
}

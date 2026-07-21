import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { AgentId, UserId } from '@agent-village/shared';
import { getConfig, getDocumentClient } from './client.js';
import {
  GSI1_NAME,
  RUN_SK_PREFIX,
  agentPk,
  runMonthSkPrefix,
  userBudgetSk,
  userPk,
} from './keys.js';

/**
 * Recomputed-vs-persisted comparisons for the report-only budget-drift job
 * (services/budget-drift.ts). These read the Run partitions directly rather
 * than trusting the accumulators on the AGENT/BUDGET# items, so they must
 * never be used on a request path — only by the low-frequency drift sweep.
 */

export interface UserMonthCostSummary {
  costUsd: number;
  inFlightReservedUsd: number;
  runCount: number;
}

/**
 * All the owner's runs in `now`'s UTC calendar month, via GSI1
 * (gsi1pk=USER#<sub>, gsi1sk=RUN#<createdAt>). `costUsd` is settled spend;
 * `inFlightReservedUsd` sums each run's `reservedUsd` but ONLY for runs
 * reserved against THIS window (`budgetWindowKey` equality) — a run reserved
 * in a prior month and still in flight must not double-count into the
 * current month's expected total. Paginates.
 */
export async function sumUserMonthCost(ownerSub: UserId, now: Date): Promise<UserMonthCostSummary> {
  const { tableName } = getConfig();
  const client = getDocumentClient();
  const summary: UserMonthCostSummary = { costUsd: 0, inFlightReservedUsd: 0, runCount: 0 };
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :month)',
        ExpressionAttributeValues: { ':pk': userPk(ownerSub), ':month': runMonthSkPrefix(now) },
        ProjectionExpression: 'costUsd, reservedUsd, budgetWindowKey',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const cost = item['costUsd'];
      summary.costUsd += typeof cost === 'number' ? cost : 0;
      const reserved = item['reservedUsd'];
      if (typeof reserved === 'number' && item['budgetWindowKey'] === userBudgetSk(now)) {
        summary.inFlightReservedUsd += reserved;
      }
      summary.runCount += 1;
    }
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return summary;
}

export interface AgentLifetimeCostSummary {
  costUsd: number;
  inFlightReservedUsd: number;
}

/**
 * The whole AGENT#<id> partition's expected `spendUsedUsd` accumulator:
 * settled `costUsd` plus any still-outstanding `reservedUsd`. Paginates.
 */
export async function sumAgentLifetimeCost(agentId: AgentId): Promise<AgentLifetimeCostSummary> {
  const { tableName } = getConfig();
  const client = getDocumentClient();
  const summary: AgentLifetimeCostSummary = { costUsd: 0, inFlightReservedUsd: 0 };
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: { ':pk': agentPk(agentId), ':skPrefix': RUN_SK_PREFIX },
        ProjectionExpression: 'costUsd, reservedUsd',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const cost = item['costUsd'];
      summary.costUsd += typeof cost === 'number' ? cost : 0;
      const reserved = item['reservedUsd'];
      if (typeof reserved === 'number') summary.inFlightReservedUsd += reserved;
    }
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return summary;
}

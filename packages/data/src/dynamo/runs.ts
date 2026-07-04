import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  RunSchema,
  type Run,
  type RunStatus,
  type AgentId,
  type RunId,
} from '@agent-village/shared';
import { RunNotFoundError } from '@agent-village/domain';
import { getConfig, getDocumentClient } from './client.js';
import { isConditionalCheckFailed } from './errors-map.js';
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

export interface RunPatch {
  status?: RunStatus;
  durationMs?: number;
  exitCode?: number | null;
  error?: string | null;
  output?: string | null;
  costUsd?: number;
  taskArn?: string | null;
}

function buildRunUpdate(patch: RunPatch): {
  expression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
} {
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue;
    sets.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = val;
  }
  return { expression: `SET ${sets.join(', ')}`, names, values };
}

/**
 * Update an existing run in place — used by the sandbox lifecycle handler to
 * move a `running` run to a terminal status. The caller supplies `createdAt`
 * (recover it via `getOne`) because it is part of the sort key.
 */
export async function patchRun(
  agentId: AgentId,
  createdAt: string,
  runId: RunId,
  patch: RunPatch,
): Promise<Run> {
  const { tableName } = getConfig();
  const built = buildRunUpdate(patch);
  try {
    const res = await getDocumentClient().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: agentPk(agentId), sk: runSk(createdAt, runId) },
        UpdateExpression: built.expression,
        ExpressionAttributeNames: built.names,
        ExpressionAttributeValues: built.values,
        ConditionExpression: 'attribute_exists(pk)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return RunSchema.parse(res.Attributes);
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new RunNotFoundError(agentId, runId);
    throw err;
  }
}

export interface RunUsageDelta {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Atomically accumulate one LLM call's usage onto a run record. Used by the
 * Anthropic metering gateway (ADR 0004): a sandbox run makes many calls, so
 * this is an `ADD`, never a `SET` — concurrent calls cannot clobber each other.
 */
export async function addRunUsage(
  agentId: AgentId,
  createdAt: string,
  runId: RunId,
  delta: RunUsageDelta,
): Promise<void> {
  const { tableName } = getConfig();
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: agentPk(agentId), sk: runSk(createdAt, runId) },
        UpdateExpression: 'ADD costUsd :cost, tokensIn :tokensIn, tokensOut :tokensOut',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: {
          ':cost': delta.costUsd,
          ':tokensIn': delta.tokensIn,
          ':tokensOut': delta.tokensOut,
        },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new RunNotFoundError(agentId, runId);
    throw err;
  }
}

export async function getOne(agentId: AgentId, runId: RunId): Promise<Run | null> {
  const { tableName } = getConfig();
  const client = getDocumentClient();
  // The run id alone can't reconstruct the createdAt-prefixed sort key, so we
  // scan the partition. Paginate so a match beyond the first page is still found.
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': agentPk(agentId),
          ':skPrefix': RUN_SK_PREFIX,
        },
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const match = (res.Items ?? []).find((item) => item['id'] === runId);
    if (match) return RunSchema.parse(match);
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return null;
}

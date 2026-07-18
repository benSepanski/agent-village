import { PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  RunSchema,
  type Run,
  type RunEvent,
  type RunStatus,
  type AgentId,
  type RunId,
} from '@agent-village/shared';
import { RunNotFoundError } from '@agent-village/domain';
import { getConfig, getDocumentClient } from './client.js';
import { isConditionalCheckFailed } from './errors-map.js';
import { RUN_SK_PREFIX, agentPk, runGsi1sk, runMonthSkPrefix, runSk, userPk } from './keys.js';

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
  reservedUsd?: number | null;
  /** Nulled at terminal settlement so a leaked per-run gateway token dies with the run. */
  gatewayTokenHash?: string | null;
  /** Full replacement of the observed-events list (callers merge before patching). */
  events?: RunEvent[];
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

/**
 * Atomically claim (and clear) a run's compute-spend reservation. Returns the
 * reserved amount exactly once — every later (or concurrent) claim returns
 * null. EventBridge stop events are at-least-once and may be processed
 * concurrently, and a launch-failure refund can race the stop event of the
 * aborted task; the conditional write makes whichever settlement path wins the
 * only one that applies money.
 */
export async function claimRunReservation(
  agentId: AgentId,
  createdAt: string,
  runId: RunId,
): Promise<number | null> {
  const { tableName } = getConfig();
  try {
    const res = await getDocumentClient().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: agentPk(agentId), sk: runSk(createdAt, runId) },
        UpdateExpression: 'SET reservedUsd = :nul',
        ConditionExpression: 'attribute_exists(pk) AND attribute_type(reservedUsd, :num)',
        ExpressionAttributeValues: { ':nul': null, ':num': 'N' },
        ReturnValues: 'UPDATED_OLD',
      }),
    );
    const prior = res.Attributes?.['reservedUsd'];
    return typeof prior === 'number' ? prior : null;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return null; // already claimed (or never reserved)
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

export interface MonthCostSummary {
  costUsd: number;
  runCount: number;
}

/**
 * Month-to-date spend for one agent: a key-condition range query over the
 * runs created in `now`'s UTC calendar month (the sort key embeds the ISO
 * `createdAt`, so `begins_with(RUN#YYYY-MM-)` is the whole month), summing
 * each run's `costUsd`. Paginates, so no accumulator table is needed.
 */
export async function sumMonthCost(agentId: AgentId, now: Date): Promise<MonthCostSummary> {
  const { tableName } = getConfig();
  const client = getDocumentClient();
  const summary: MonthCostSummary = { costUsd: 0, runCount: 0 };
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :month)',
        ExpressionAttributeValues: {
          ':pk': agentPk(agentId),
          ':month': runMonthSkPrefix(now),
        },
        ProjectionExpression: 'costUsd',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const cost = item['costUsd'];
      summary.costUsd += typeof cost === 'number' ? cost : 0;
      summary.runCount += 1;
    }
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return summary;
}

/**
 * Find sandbox runs wedged in `status:'running'` — created before `olderThanIso`
 * yet never moved to a terminal state (e.g. the lifecycle finalizer had a
 * multi-hour outage or a poison-pill stop event was dropped). The stuck-run
 * sweeper reuses `finalizeSandboxRun` to settle each one and free the agent's
 * run slot.
 *
 * There is no index on `status`, so this is a filtered table Scan across the
 * whole table. It is deliberately driven only by the low-frequency sweeper (a
 * last-resort backstop) and at personal scale the table is small; a GSI keyed
 * on `status` is the efficient alternative to introduce if run volume ever
 * grows (see followups). Paginate so a match beyond the first page is found.
 */
export async function listStuckSandboxRuns(olderThanIso: string): Promise<Run[]> {
  const { tableName } = getConfig();
  const client = getDocumentClient();
  const stuck: Run[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: tableName,
        // `status` is a DynamoDB reserved word; alias it. Only `running` runs
        // are sandbox runs, so no `kind` predicate is needed to exclude inline.
        FilterExpression:
          'begins_with(sk, :runPrefix) AND #status = :running AND createdAt < :cutoff',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':runPrefix': RUN_SK_PREFIX,
          ':running': 'running',
          ':cutoff': olderThanIso,
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) stuck.push(RunSchema.parse(item));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return stuck;
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

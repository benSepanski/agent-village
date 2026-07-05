import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  type FilteredLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { runRepo } from '@agent-village/data';
import { RunNotFoundError } from '@agent-village/domain';
import type { AgentId, RunId, RunStatus, UserId } from '@agent-village/shared';
import { getMyAgent } from './agent.js';

/**
 * Live observability (Phase 3 step 07): owner-scoped passthrough over
 * CloudWatch `FilterLogEvents` for one sandbox run's log streams. The sandbox
 * task definition logs both containers with awslogs `streamPrefix: 'sandbox'`,
 * so a run's streams are `sandbox/<container>/<taskId>` where the task id is
 * the last segment of the run's `taskArn`.
 */

let cached: CloudWatchLogsClient | undefined;

export function getLogsClient(): CloudWatchLogsClient {
  cached ??= new CloudWatchLogsClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
  return cached;
}

/** Test-only: inject a mock CloudWatchLogsClient. */
export function setLogsClient(client: CloudWatchLogsClient | undefined): void {
  cached = client;
}

/** Lockstep with the sandbox task definition (sandbox-stack.ts): awslogs streamPrefix. */
const STREAM_PREFIX = 'sandbox';
/** Container names in the sandbox task definition, each with its own stream. */
const CONTAINERS = ['app', 'egress-proxy'] as const;
const DEFAULT_LIMIT = 200;

export interface RunLogEvent {
  /** ISO timestamp of the log event. */
  at: string;
  /** Which container emitted it: `app` or `egress-proxy`. */
  source: string;
  message: string;
}

export interface RunLogsPage {
  /** Current run status, so callers know whether to keep polling. */
  runStatus: RunStatus;
  events: RunLogEvent[];
  /** CloudWatch pagination token; null when this page is the last (for now). */
  nextToken: string | null;
}

export interface RunLogsQuery {
  nextToken?: string;
  /** Only events at or after this epoch-milliseconds instant (for follow polling). */
  startTimeMs?: number;
  limit?: number;
}

function logGroupName(): string {
  const name = process.env['AV_SANDBOX_LOG_GROUP'];
  if (!name) throw new Error('AV_SANDBOX_LOG_GROUP env var is required');
  return name;
}

function streamNames(taskArn: string): string[] {
  const taskId = taskArn.split('/').at(-1) ?? taskArn;
  return CONTAINERS.map((container) => `${STREAM_PREFIX}/${container}/${taskId}`);
}

function toRunLogEvent(event: FilteredLogEvent): RunLogEvent {
  return {
    at: new Date(event.timestamp ?? 0).toISOString(),
    source: event.logStreamName?.split('/')[1] ?? 'app',
    message: (event.message ?? '').replace(/\n$/, ''),
  };
}

interface FilteredPage {
  events: FilteredLogEvent[];
  nextToken: string | null;
}

async function filterEvents(taskArn: string, query: RunLogsQuery): Promise<FilteredPage> {
  const res = await getLogsClient().send(
    new FilterLogEventsCommand({
      logGroupName: logGroupName(),
      logStreamNames: streamNames(taskArn),
      limit: query.limit ?? DEFAULT_LIMIT,
      ...(query.nextToken !== undefined ? { nextToken: query.nextToken } : {}),
      ...(query.startTimeMs !== undefined ? { startTime: query.startTimeMs } : {}),
    }),
  );
  return { events: res.events ?? [], nextToken: res.nextToken ?? null };
}

function emptyPage(runStatus: RunStatus): RunLogsPage {
  return { runStatus, events: [], nextToken: null };
}

/**
 * One page of a sandbox run's CloudWatch log events, owner-scoped. Inline runs
 * (and sandbox runs that never got a task) have no sandbox streams, so they
 * return an empty page. A missing log group/stream (expired retention, task
 * produced no output yet) also returns an empty page rather than an error.
 */
export async function getRunLogs(
  ownerSub: UserId,
  agentId: AgentId,
  runId: RunId,
  query: RunLogsQuery = {},
): Promise<RunLogsPage> {
  await getMyAgent(ownerSub, agentId);
  const run = await runRepo.getOne(agentId, runId);
  if (!run) throw new RunNotFoundError(agentId, runId);
  if (run.kind !== 'sandbox' || !run.taskArn) return emptyPage(run.status);
  try {
    const page = await filterEvents(run.taskArn, query);
    return {
      runStatus: run.status,
      events: page.events.map(toRunLogEvent),
      nextToken: page.nextToken,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'ResourceNotFoundException') {
      return emptyPage(run.status);
    }
    throw err;
  }
}

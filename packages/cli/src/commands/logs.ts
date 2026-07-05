import { client, type ApiClient } from '../client.js';
import { kv, statusColor } from '../format.js';

interface RunDetail {
  id: string;
  agentId: string;
  status: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  output: string | null;
  error: string | null;
  traceId: string;
  createdAt: string;
}

interface RunLogEvent {
  at: string;
  source: string;
  message: string;
}

interface RunLogsPage {
  runStatus: string;
  events: RunLogEvent[];
  nextToken: string | null;
}

export interface LogsOptions {
  /** Poll for new log events until the run reaches a terminal status. */
  follow?: boolean;
  /** Poll interval in ms (tests pass 0). */
  pollMs?: number;
  /** Output sink for streamed lines; defaults to process.stdout. */
  write?: (chunk: string) => void;
}

const TERMINAL_STATUSES = new Set([
  'ok',
  'error',
  'spend_limit_exceeded',
  'timed_out',
  'launch_failed',
]);
const DEFAULT_POLL_MS = 3000;
const PAGE_LIMIT = 200;

function logsPath(agentId: string, runId: string, startTime: number, token?: string): string {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (startTime > 0) params.set('startTime', String(startTime));
  if (token) params.set('nextToken', token);
  return `/agents/${agentId}/runs/${runId}/logs?${params.toString()}`;
}

function formatEvent(e: RunLogEvent): string {
  return `${e.at} [${e.source}] ${e.message}`;
}

function runMeta(run: RunDetail): string {
  return kv([
    ['runId', run.id],
    ['agentId', run.agentId],
    ['status', statusColor(run.status)],
    ['cost', `$${run.costUsd.toFixed(4)}`],
    ['tokens', `in=${run.tokensIn} out=${run.tokensOut}`],
    ['duration', `${run.durationMs}ms`],
    ['traceId', run.traceId],
    ['createdAt', run.createdAt],
  ]);
}

interface DrainResult {
  status: string;
  /** Exclusive start time for the next poll: last seen event + 1ms. */
  nextStart: number;
}

/** Fetch and emit every available page from `startTime` onward. */
async function drainOnce(
  c: ApiClient,
  ids: { agentId: string; runId: string },
  startTime: number,
  write: (chunk: string) => void,
): Promise<DrainResult> {
  let token: string | undefined;
  let status = 'running';
  let nextStart = startTime;
  do {
    const page = await c.get<RunLogsPage>(logsPath(ids.agentId, ids.runId, startTime, token));
    status = page.runStatus;
    for (const e of page.events) {
      write(`${formatEvent(e)}\n`);
      nextStart = Math.max(nextStart, Date.parse(e.at) + 1);
    }
    token = page.nextToken ?? undefined;
  } while (token);
  return { status, nextStart };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function followLogs(
  c: ApiClient,
  ids: { agentId: string; runId: string },
  opts: { pollMs: number; write: (chunk: string) => void },
): Promise<string> {
  let startTime = 0;
  for (;;) {
    const { status, nextStart } = await drainOnce(c, ids, startTime, opts.write);
    startTime = nextStart;
    if (TERMINAL_STATUSES.has(status)) return status;
    await sleep(opts.pollMs);
  }
}

export async function logs(
  agentId: string,
  runId: string,
  opts: LogsOptions = {},
): Promise<string> {
  const c = await client();
  const run = await c.get<RunDetail>(`/agents/${agentId}/runs/${runId}`);
  const meta = runMeta(run);
  if (opts.follow) {
    const write = opts.write ?? ((chunk: string) => void process.stdout.write(chunk));
    write(`${meta}\n\n`);
    const status = await followLogs(
      c,
      { agentId, runId },
      { pollMs: opts.pollMs ?? DEFAULT_POLL_MS, write },
    );
    return `run finished: ${statusColor(status)}`;
  }
  const body = run.error ? `error: ${run.error}` : `output:\n${run.output ?? '(empty)'}`;
  const lines: string[] = [];
  await drainOnce(c, { agentId, runId }, 0, (chunk) => void lines.push(chunk.trimEnd()));
  const logBlock = lines.length ? `\n\nlogs:\n${lines.join('\n')}` : '';
  return `${meta}\n\n${body}${logBlock}`;
}

import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api-client/client.js';

export interface RunLogEvent {
  at: string;
  source: string;
  message: string;
}

export interface RunLogsPage {
  runStatus: string;
  events: RunLogEvent[];
  nextToken: string | null;
}

const POLL_MS = 5000;
const PAGE_LIMIT = 200;
const TERMINAL_STATUSES = new Set([
  'ok',
  'error',
  'timed_out',
  'launch_failed',
  'spend_limit_exceeded',
]);

/**
 * Poll interval for the log panel, decided from the freshest data rather than a
 * frozen prop: stop as soon as any loaded page reports a terminal run status so
 * a finished run doesn't poll (one FilterLogEvents call per loaded page)
 * forever. Before the first page arrives, fall back to the initial `running`.
 */
export function nextPollInterval(
  pages: readonly RunLogsPage[] | undefined,
  running: boolean,
): number | false {
  if (!pages || pages.length === 0) return running ? POLL_MS : false;
  return pages.some((page) => TERMINAL_STATUSES.has(page.runStatus)) ? false : POLL_MS;
}

function logsPath(agentId: string, runId: string, token: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (token) params.set('nextToken', token);
  return `/agents/${agentId}/runs/${runId}/logs?${params.toString()}`;
}

export interface RunLogsProps {
  agentId: string;
  runId: string;
  /**
   * The run's status when the page last loaded — seeds polling. Polling then
   * self-terminates from each page's own `runStatus`, so a run that finishes
   * while the panel is open stops the poll without a manual reload.
   */
  running: boolean;
}

/**
 * Log panel for a sandbox run (Phase 3 step 07): pages CloudWatch events
 * through the run-logs API route and auto-refreshes while the run is live.
 */
export function RunLogs({ agentId, runId, running }: RunLogsProps) {
  const query = useInfiniteQuery<RunLogsPage>({
    queryKey: ['agents', agentId, 'runs', runId, 'logs'],
    queryFn: ({ pageParam }) => api.get(logsPath(agentId, runId, pageParam as string | null)),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextToken,
    refetchInterval: (query) => nextPollInterval(query.state.data?.pages, running),
  });
  if (query.isPending) return <p>Loading logs…</p>;
  if (query.error) return <p role="alert">Failed to load logs.</p>;
  const events = (query.data?.pages ?? []).flatMap((page) => page.events);
  return (
    <section>
      {events.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No log events{running ? ' yet' : ''}.</p>
      ) : (
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto' }}>
          {events.map((e, i) => (
            <div key={i}>
              <span style={{ color: '#6b7280' }}>{e.at}</span>{' '}
              <span style={{ color: '#1d4ed8' }}>[{e.source}]</span> {e.message}
            </div>
          ))}
        </pre>
      )}
      {query.hasNextPage ? (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}

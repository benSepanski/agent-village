import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { api } from '../api-client/client.js';
import type { Run } from '../api-client/types.js';
import { RunControls } from '../components/RunControls.js';
import { RunDetail } from '../components/RunDetail.js';
import { RunLogs } from '../components/RunLogs.js';
import { RunTimeline } from '../components/RunTimeline.js';

interface RunNowResult {
  runId: string;
  status: string;
}

export function RunDetailPage() {
  const { agentId, runId } = useParams({ from: '/agents/$agentId/runs/$runId' });
  const navigate = useNavigate();
  const {
    data: run,
    isPending,
    error,
  } = useQuery<Run>({
    queryKey: ['agents', agentId, 'runs', runId],
    queryFn: () => api.get(`/agents/${agentId}/runs/${runId}`),
    // A sandbox run finalizes asynchronously (the lifecycle Lambda patches
    // status + reconciled cost after the task stops). Poll while it is running
    // so the header status and the actual (not flat-reservation) cost appear
    // without a manual reload; stop as soon as it reaches a terminal status.
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 5000 : false),
  });
  const replay = useMutation({
    mutationFn: (opts: { dryRun: boolean; replayOfRunId?: string }) =>
      api.post<RunNowResult>(`/agents/${agentId}/run-now`, opts),
    onSuccess: (res) =>
      navigate({ to: '/agents/$agentId/runs/$runId', params: { agentId, runId: res.runId } }),
  });
  if (isPending) return <p>Loading…</p>;
  if (error || !run) return <p role="alert">Failed to load run.</p>;
  return (
    <section>
      <p>
        <Link to="/agents/$agentId" params={{ agentId }}>
          ← Back to agent
        </Link>
      </p>
      <RunDetail run={run} />
      <h4>Replay this run</h4>
      <RunControls
        replayOfRunId={runId}
        busy={replay.isPending}
        onRun={(opts) => replay.mutate(opts)}
      />
      <h4>Timeline</h4>
      <RunTimeline run={run} />
      {run.kind === 'sandbox' ? (
        <>
          <h4>Logs</h4>
          <RunLogs agentId={agentId} runId={runId} running={run.status === 'running'} />
        </>
      ) : null}
    </section>
  );
}

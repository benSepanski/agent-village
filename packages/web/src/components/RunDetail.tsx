import type { Run } from '../api-client/types.js';
import { StatusBadge } from './StatusBadge.js';

export interface RunDetailProps {
  run: Run;
  cloudWatchLink?: string;
}

function SandboxMeta({ run }: { run: Run }) {
  return (
    <>
      <dt>Task</dt>
      <dd>
        <code>{run.taskArn ?? '—'}</code>
      </dd>
      <dt>Exit code</dt>
      <dd>{run.exitCode ?? '—'}</dd>
    </>
  );
}

function TraceMeta({ run, cloudWatchLink }: RunDetailProps) {
  return (
    <>
      <dt>Trace</dt>
      <dd>
        <code>{run.traceId}</code>
        {cloudWatchLink ? (
          <>
            {' '}
            <a href={cloudWatchLink} target="_blank" rel="noreferrer">
              CloudWatch Logs Insights →
            </a>
          </>
        ) : null}
      </dd>
      {run.replayOfRunId ? (
        <>
          <dt>Replayed from</dt>
          <dd>
            <code>{run.replayOfRunId}</code>
          </dd>
        </>
      ) : null}
    </>
  );
}

function RunMeta({ run, cloudWatchLink }: RunDetailProps) {
  const isSandbox = run.kind === 'sandbox';
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 4 }}>
      <dt>Kind</dt>
      <dd>{run.kind}</dd>
      <dt>Started</dt>
      <dd>{run.createdAt}</dd>
      <dt>Duration</dt>
      <dd>{run.durationMs}ms</dd>
      <dt>Cost</dt>
      <dd>${run.costUsd.toFixed(4)}</dd>
      {isSandbox ? (
        <SandboxMeta run={run} />
      ) : (
        <>
          <dt>Tokens</dt>
          <dd>
            in={run.tokensIn} out={run.tokensOut}
          </dd>
          <dt>Model</dt>
          <dd>{run.model ?? '—'}</dd>
          <dt>Prompt hash</dt>
          <dd>
            <code>{run.systemPromptHash ?? '—'}</code>
          </dd>
        </>
      )}
      <TraceMeta run={run} {...(cloudWatchLink ? { cloudWatchLink } : {})} />
    </dl>
  );
}

export function RunDetail({ run, cloudWatchLink }: RunDetailProps) {
  return (
    <article>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <h3>Run {run.id}</h3>
        <StatusBadge status={run.status} />
        {run.dryRun ? <span style={{ color: '#92400e' }}>(dry run)</span> : null}
      </header>
      <RunMeta run={run} {...(cloudWatchLink ? { cloudWatchLink } : {})} />
      {run.error ? (
        <section style={{ marginTop: 12 }}>
          <h4 style={{ color: '#991b1b' }}>Error</h4>
          <pre>{run.error}</pre>
        </section>
      ) : null}
      {run.output ? (
        <section style={{ marginTop: 12 }}>
          <h4>Output</h4>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{run.output}</pre>
        </section>
      ) : null}
    </article>
  );
}

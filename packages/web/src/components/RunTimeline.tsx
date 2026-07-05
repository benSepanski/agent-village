import type { Run } from '../api-client/types.js';

type RunEvent = Run['events'][number];

/** Event names that are failures in themselves, regardless of run status. */
const ERROR_EVENTS = new Set<string>([
  'agent.run.failed',
  'agent.run.spend_rejected',
  'sandbox.run.launch_failed',
]);

const FAILED_STATUSES = new Set<string>([
  'error',
  'timed_out',
  'spend_limit_exceeded',
  'launch_failed',
]);

/** The terminal marker inherits the run's outcome tone. */
const TERMINAL_EVENTS = new Set<string>(['sandbox.run.finalized', 'agent.run.completed']);

export function toneFor(event: RunEvent, runStatus: Run['status']): 'normal' | 'error' {
  if (ERROR_EVENTS.has(event.event)) return 'error';
  if (TERMINAL_EVENTS.has(event.event) && FAILED_STATUSES.has(runStatus)) return 'error';
  return 'normal';
}

/**
 * Renders the lifecycle transitions actually observed for this run (persisted
 * on the Run record — Phase 3 step 07). Runs persisted before events existed
 * get an honest empty state instead of fabricated timestamps.
 */
export function RunTimeline({ run }: { run: Run }) {
  if (run.events.length === 0) {
    return (
      <p style={{ color: '#6b7280' }}>
        {run.status === 'running'
          ? 'No events recorded yet.'
          : 'No recorded events for this run (it predates event capture).'}
      </p>
    );
  }
  return (
    <ol style={{ paddingLeft: 0, listStyle: 'none' }}>
      {run.events.map((e, i) => (
        <li
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '220px 1fr',
            gap: 12,
            padding: '4px 0',
            color: toneFor(e, run.status) === 'error' ? '#991b1b' : '#1f2937',
          }}
        >
          <time style={{ fontFamily: 'monospace' }}>{e.at}</time>
          <code>{e.event}</code>
        </li>
      ))}
    </ol>
  );
}

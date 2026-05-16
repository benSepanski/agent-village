import type { Run } from '../api-client/types.js';

interface TimelineEvent {
  event: string;
  timestamp: string;
  tone: 'normal' | 'error';
}

const EVENT_SEQUENCE = [
  'agent.run.started',
  'agent.run.config_loaded',
  'agent.run.spend_reserved',
  'agent.run.secret_fetched',
  'agent.run.anthropic_call',
  'agent.run.anthropic_response',
  'agent.run.spend_finalized',
  'agent.run.persisted',
  'agent.run.completed',
] as const;

const FAILED_EVENTS = new Set(['agent.run.failed', 'agent.run.spend_rejected']);

function toEvent(
  event: string,
  start: number,
  offsetMs: number,
  tone: TimelineEvent['tone'] = 'normal',
): TimelineEvent {
  return { event, timestamp: new Date(start + offsetMs).toISOString(), tone };
}

const REJECTED_NAMES = ['agent.run.started', 'agent.run.config_loaded', 'agent.run.spend_rejected'];
const ERROR_NAMES = [
  'agent.run.started',
  'agent.run.config_loaded',
  'agent.run.spend_reserved',
  'agent.run.secret_fetched',
  'agent.run.anthropic_call',
  'agent.run.failed',
];

function buildEvents(run: Run): TimelineEvent[] {
  // Without CloudWatch Logs Insights wired up yet, we reconstruct the
  // canonical event sequence from the Run record. CW deep-link in RunDetail
  // gives the user the real raw events.
  const start = new Date(run.createdAt).getTime();
  if (run.status === 'spend_limit_exceeded') {
    return REJECTED_NAMES.map((name, i) =>
      toEvent(name, start, i, name === 'agent.run.spend_rejected' ? 'error' : 'normal'),
    );
  }
  if (run.status === 'error') {
    const errorStep = run.durationMs / Math.max(1, ERROR_NAMES.length - 1);
    return ERROR_NAMES.map((name, i) =>
      toEvent(name, start, errorStep * i, name === 'agent.run.failed' ? 'error' : 'normal'),
    );
  }
  const step = run.durationMs / Math.max(1, EVENT_SEQUENCE.length - 1);
  return EVENT_SEQUENCE.map((name, i) =>
    toEvent(name, start, step * i, FAILED_EVENTS.has(name) ? 'error' : 'normal'),
  );
}

export function RunTimeline({ run }: { run: Run }) {
  const events = buildEvents(run);
  return (
    <ol style={{ paddingLeft: 0, listStyle: 'none' }}>
      {events.map((e, i) => (
        <li
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '220px 1fr',
            gap: 12,
            padding: '4px 0',
            color: e.tone === 'error' ? '#991b1b' : '#1f2937',
          }}
        >
          <time style={{ fontFamily: 'monospace' }}>{e.timestamp}</time>
          <code>{e.event}</code>
        </li>
      ))}
    </ol>
  );
}

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

function buildEvents(run: Run): TimelineEvent[] {
  // Without CloudWatch Logs Insights wired up yet, we reconstruct the
  // canonical event sequence from the Run record. CW deep-link below gives
  // the user the real raw events.
  const start = new Date(run.createdAt).getTime();
  const step = run.durationMs / Math.max(1, EVENT_SEQUENCE.length - 1);

  if (run.status === 'spend_limit_exceeded') {
    return [
      { event: 'agent.run.started', timestamp: new Date(start).toISOString(), tone: 'normal' },
      {
        event: 'agent.run.config_loaded',
        timestamp: new Date(start + 1).toISOString(),
        tone: 'normal',
      },
      {
        event: 'agent.run.spend_rejected',
        timestamp: new Date(start + 2).toISOString(),
        tone: 'error',
      },
    ];
  }
  if (run.status === 'error') {
    return [
      { event: 'agent.run.started', timestamp: new Date(start).toISOString(), tone: 'normal' },
      {
        event: 'agent.run.config_loaded',
        timestamp: new Date(start + step).toISOString(),
        tone: 'normal',
      },
      {
        event: 'agent.run.spend_reserved',
        timestamp: new Date(start + step * 2).toISOString(),
        tone: 'normal',
      },
      {
        event: 'agent.run.secret_fetched',
        timestamp: new Date(start + step * 3).toISOString(),
        tone: 'normal',
      },
      {
        event: 'agent.run.anthropic_call',
        timestamp: new Date(start + step * 4).toISOString(),
        tone: 'normal',
      },
      {
        event: 'agent.run.failed',
        timestamp: new Date(start + run.durationMs).toISOString(),
        tone: 'error',
      },
    ];
  }
  return EVENT_SEQUENCE.map((event, i) => ({
    event,
    timestamp: new Date(start + step * i).toISOString(),
    tone: FAILED_EVENTS.has(event) ? 'error' : 'normal',
  }));
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

import type { Run } from '../api-client/types.js';

export interface TimelineEvent {
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
const REJECTED_NAMES = ['agent.run.started', 'agent.run.config_loaded', 'agent.run.spend_rejected'];
const ERROR_NAMES = [
  'agent.run.started',
  'agent.run.config_loaded',
  'agent.run.spend_reserved',
  'agent.run.secret_fetched',
  'agent.run.anthropic_call',
  'agent.run.failed',
];

function toEvent(
  event: string,
  start: number,
  offsetMs: number,
  tone: TimelineEvent['tone'] = 'normal',
): TimelineEvent {
  return { event, timestamp: new Date(start + offsetMs).toISOString(), tone };
}

function buildInlineEvents(run: Run): TimelineEvent[] {
  // Without CloudWatch Logs Insights wired up yet, we reconstruct the canonical
  // event sequence from the Run record. The CW deep-link gives the raw events.
  const start = new Date(run.createdAt).getTime();
  if (run.status === 'spend_limit_exceeded') {
    return REJECTED_NAMES.map((name, i) =>
      toEvent(name, start, i, name === 'agent.run.spend_rejected' ? 'error' : 'normal'),
    );
  }
  if (run.status === 'error') {
    const step = run.durationMs / Math.max(1, ERROR_NAMES.length - 1);
    return ERROR_NAMES.map((name, i) =>
      toEvent(name, start, step * i, name === 'agent.run.failed' ? 'error' : 'normal'),
    );
  }
  const step = run.durationMs / Math.max(1, EVENT_SEQUENCE.length - 1);
  return EVENT_SEQUENCE.map((name, i) =>
    toEvent(name, start, step * i, FAILED_EVENTS.has(name) ? 'error' : 'normal'),
  );
}

function buildSandboxEvents(run: Run): TimelineEvent[] {
  const start = new Date(run.createdAt).getTime();
  if (run.status === 'launch_failed') {
    return [
      toEvent('agent.run.started', start, 0),
      toEvent('sandbox.run.launch_failed', start, 1, 'error'),
    ];
  }
  if (run.status === 'running') {
    return [
      toEvent('agent.run.started', start, 0),
      toEvent('sandbox.run.sync_down', start, 1),
      toEvent('sandbox.run.running', start, 2),
    ];
  }
  const step = run.durationMs / 4;
  const failed = run.status !== 'ok';
  return [
    toEvent('agent.run.started', start, 0),
    toEvent('sandbox.run.sync_down', start, step),
    toEvent('sandbox.run.app_exited', start, step * 2, failed ? 'error' : 'normal'),
    toEvent('sandbox.run.sync_up', start, step * 3),
    toEvent(
      failed ? 'agent.run.failed' : 'agent.run.completed',
      start,
      step * 4,
      failed ? 'error' : 'normal',
    ),
  ];
}

export function buildEvents(run: Run): TimelineEvent[] {
  return run.kind === 'sandbox' ? buildSandboxEvents(run) : buildInlineEvents(run);
}

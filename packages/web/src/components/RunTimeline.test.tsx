import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RunTimeline, toneFor } from './RunTimeline.js';
import type { Run } from '../api-client/types.js';

afterEach(() => cleanup());

const baseRun: Run = {
  id: '01HZN0PQRSTVWXYZ0123456789' as Run['id'],
  agentId: '01HZ1234567890ABCDEFGHJKMN' as Run['agentId'],
  ownerSub: 'cog-sub' as Run['ownerSub'],
  status: 'ok',
  kind: 'inline',
  costUsd: 0.001,
  tokensIn: 10,
  tokensOut: 20,
  output: 'hi',
  error: null,
  durationMs: 800,
  traceId: 'Root=1',
  model: 'claude-opus-4-7',
  systemPromptHash: 'sha256:abc',
  dryRun: false,
  replayOfRunId: null,
  taskArn: null,
  exitCode: null,
  gatewayTokenHash: null,
  reservedUsd: null,
  budgetWindowKey: null,
  events: [
    { event: 'agent.run.started', at: '2026-05-16T12:00:00.000Z' },
    { event: 'agent.run.completed', at: '2026-05-16T12:00:00.800Z' },
  ],
  createdAt: '2026-05-16T12:00:00.000Z',
};

describe('RunTimeline', () => {
  it('renders the persisted events with their observed timestamps', () => {
    render(<RunTimeline run={baseRun} />);
    expect(screen.getByText('agent.run.started')).toBeDefined();
    expect(screen.getByText('agent.run.completed')).toBeDefined();
    expect(screen.getByText('2026-05-16T12:00:00.000Z')).toBeDefined();
    expect(screen.getByText('2026-05-16T12:00:00.800Z')).toBeDefined();
  });

  it('does not fabricate events: only persisted ones appear', () => {
    render(<RunTimeline run={baseRun} />);
    expect(screen.queryByText('agent.run.anthropic_call')).toBeNull();
    expect(screen.queryByText('agent.run.spend_reserved')).toBeNull();
  });

  it('renders the observed sandbox transitions', () => {
    render(
      <RunTimeline
        run={{
          ...baseRun,
          kind: 'sandbox',
          model: null,
          systemPromptHash: null,
          exitCode: 0,
          events: [
            { event: 'sandbox.run.launched', at: '2026-05-16T12:00:00.000Z' },
            { event: 'sandbox.run.task_started', at: '2026-05-16T12:00:20.000Z' },
            { event: 'sandbox.run.task_stopped', at: '2026-05-16T12:03:00.000Z' },
            { event: 'sandbox.run.finalized', at: '2026-05-16T12:03:02.000Z' },
          ],
        }}
      />,
    );
    expect(screen.getByText('sandbox.run.launched')).toBeDefined();
    expect(screen.getByText('sandbox.run.task_started')).toBeDefined();
    expect(screen.getByText('sandbox.run.task_stopped')).toBeDefined();
    expect(screen.getByText('sandbox.run.finalized')).toBeDefined();
  });

  it('shows an honest empty state for legacy runs without persisted events', () => {
    render(<RunTimeline run={{ ...baseRun, events: [] }} />);
    expect(screen.getByText(/No recorded events/)).toBeDefined();
  });

  it('shows a waiting empty state for a running run without events yet', () => {
    render(<RunTimeline run={{ ...baseRun, status: 'running', events: [] }} />);
    expect(screen.getByText('No events recorded yet.')).toBeDefined();
  });
});

describe('toneFor (timeline event mapping)', () => {
  const at = '2026-05-16T12:00:00.000Z';

  it('marks failure events as errors regardless of status', () => {
    expect(toneFor({ event: 'sandbox.run.launch_failed', at }, 'launch_failed')).toBe('error');
    expect(toneFor({ event: 'agent.run.failed', at }, 'error')).toBe('error');
    expect(toneFor({ event: 'agent.run.spend_rejected', at }, 'spend_limit_exceeded')).toBe(
      'error',
    );
  });

  it('tones the terminal marker by run outcome', () => {
    expect(toneFor({ event: 'sandbox.run.finalized', at }, 'ok')).toBe('normal');
    expect(toneFor({ event: 'sandbox.run.finalized', at }, 'error')).toBe('error');
    expect(toneFor({ event: 'sandbox.run.finalized', at }, 'timed_out')).toBe('error');
    expect(toneFor({ event: 'agent.run.completed', at }, 'ok')).toBe('normal');
  });

  it('keeps intermediate transitions neutral', () => {
    expect(toneFor({ event: 'sandbox.run.task_started', at }, 'error')).toBe('normal');
    expect(toneFor({ event: 'agent.run.started', at }, 'error')).toBe('normal');
  });
});

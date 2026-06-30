import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RunTimeline } from './RunTimeline.js';
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
  createdAt: '2026-05-16T12:00:00.000Z',
};

describe('RunTimeline', () => {
  it('renders the full happy-path sequence for status=ok', () => {
    render(<RunTimeline run={baseRun} />);
    expect(screen.getByText('agent.run.started')).toBeDefined();
    expect(screen.getByText('agent.run.anthropic_call')).toBeDefined();
    expect(screen.getByText('agent.run.completed')).toBeDefined();
  });

  it('renders only the rejected slice for spend_limit_exceeded', () => {
    render(<RunTimeline run={{ ...baseRun, status: 'spend_limit_exceeded' }} />);
    expect(screen.getByText('agent.run.spend_rejected')).toBeDefined();
    expect(screen.queryByText('agent.run.anthropic_call')).toBeNull();
  });

  it('shows agent.run.failed for status=error', () => {
    render(<RunTimeline run={{ ...baseRun, status: 'error', error: 'boom', output: null }} />);
    expect(screen.getByText('agent.run.failed')).toBeDefined();
    expect(screen.queryByText('agent.run.completed')).toBeNull();
  });

  it('renders the sandbox sequence for a completed sandbox run', () => {
    render(
      <RunTimeline
        run={{ ...baseRun, kind: 'sandbox', model: null, systemPromptHash: null, exitCode: 0 }}
      />,
    );
    expect(screen.getByText('sandbox.run.sync_down')).toBeDefined();
    expect(screen.getByText('sandbox.run.app_exited')).toBeDefined();
    expect(screen.getByText('agent.run.completed')).toBeDefined();
    expect(screen.queryByText('agent.run.anthropic_call')).toBeNull();
  });

  it('stops at a running marker for an in-flight sandbox run', () => {
    render(
      <RunTimeline
        run={{
          ...baseRun,
          kind: 'sandbox',
          status: 'running',
          model: null,
          systemPromptHash: null,
        }}
      />,
    );
    expect(screen.getByText('sandbox.run.running')).toBeDefined();
    expect(screen.queryByText('agent.run.completed')).toBeNull();
  });
});

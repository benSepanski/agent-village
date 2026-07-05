import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RunSchema } from '../api-client/types.js';
import { RunDetail } from './RunDetail.js';

afterEach(() => cleanup());

const base = {
  id: '01HZN0PQRSTVWXYZ0123456789',
  agentId: '01HZ1234567890ABCDEFGHJKMN',
  ownerSub: 'cog-sub-abc',
  kind: 'sandbox',
  output: null,
  error: null,
  traceId: 'trace-1',
  dryRun: false,
  taskArn: 'arn:aws:ecs:us-east-1:0:task/abc',
  createdAt: '2026-07-01T12:00:00.000Z',
};

describe('RunDetail — actual cost, not the flat estimate (Phase 3 steps 06/09)', () => {
  it('shows the reconciled costUsd for a finalized sandbox run', () => {
    // After finalization costUsd holds actual compute + actual LLM usage and
    // the flat reservation marker is nulled — the viewer shows the actual.
    const run = RunSchema.parse({
      ...base,
      status: 'ok',
      costUsd: 0.0016,
      reservedUsd: null,
      durationMs: 120_000,
      exitCode: 0,
    });
    render(<RunDetail run={run} />);
    expect(screen.getByText('$0.0016')).toBeDefined();
  });

  it('never renders reservedUsd — an in-flight run shows accumulated costUsd only', () => {
    const run = RunSchema.parse({
      ...base,
      status: 'running',
      costUsd: 0.007, // flat compute reservation + metered LLM usage so far
      reservedUsd: 0.0062, // still-unreconciled flat estimate
      durationMs: 0,
      exitCode: null,
    });
    render(<RunDetail run={run} />);
    expect(screen.getByText('$0.0070')).toBeDefined();
    expect(screen.queryByText(/0\.0062/)).toBeNull();
  });

  it('shows the breach status and actual cost for a mid-run spend_limit_exceeded run', () => {
    const run = RunSchema.parse({
      ...base,
      status: 'spend_limit_exceeded',
      costUsd: 0.0025,
      reservedUsd: null,
      durationMs: 90_000,
      exitCode: 1,
      error: 'spend limit exceeded mid-run; Anthropic calls rejected by the metering gateway',
    });
    render(<RunDetail run={run} />);
    expect(screen.getByText('spend-limit')).toBeDefined();
    expect(screen.getByText('$0.0025')).toBeDefined();
    expect(screen.getByText(/rejected by the metering gateway/)).toBeDefined();
  });
});

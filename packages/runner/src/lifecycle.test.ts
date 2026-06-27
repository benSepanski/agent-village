import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runnerMock } = vi.hoisted(() => ({
  runnerMock: { finalizeSandboxRun: vi.fn() },
}));

vi.mock('@agent-village/services', () => ({ runner: runnerMock }));

import { handler } from './lifecycle.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';

const stoppedEvent = {
  'detail-type': 'ECS Task State Change',
  detail: {
    lastStatus: 'STOPPED',
    startedBy: RUN_ID,
    group: `av:${AGENT_ID}`,
    stoppedReason: 'Essential container in task exited',
    startedAt: '2026-05-16T12:00:00.000Z',
    stoppedAt: '2026-05-16T12:00:05.000Z',
    containers: [{ name: 'app', exitCode: 0 }],
  },
};

beforeEach(() => {
  runnerMock.finalizeSandboxRun.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lifecycle handler', () => {
  it('finalizes the run from a STOPPED task-state-change event', async () => {
    await handler(stoppedEvent);
    expect(runnerMock.finalizeSandboxRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AGENT_ID,
        runId: RUN_ID,
        exitCode: 0,
        stoppedReason: 'Essential container in task exited',
        durationMs: 5000,
      }),
    );
  });

  it('ignores non-STOPPED events', async () => {
    await handler({
      detail: { lastStatus: 'RUNNING', startedBy: RUN_ID, group: `av:${AGENT_ID}` },
    });
    expect(runnerMock.finalizeSandboxRun).not.toHaveBeenCalled();
  });

  it('rejects a malformed event', async () => {
    await expect(handler({})).rejects.toThrow();
    expect(runnerMock.finalizeSandboxRun).not.toHaveBeenCalled();
  });

  it('rejects when startedBy is not a ULID run id', async () => {
    await expect(
      handler({ detail: { lastStatus: 'STOPPED', startedBy: 'nope', group: `av:${AGENT_ID}` } }),
    ).rejects.toThrow();
  });
});

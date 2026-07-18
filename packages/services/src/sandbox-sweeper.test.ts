import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runRepoMock, lifecycleMock } = vi.hoisted(() => ({
  runRepoMock: { listStuckSandboxRuns: vi.fn() },
  lifecycleMock: { finalizeSandboxRun: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: {},
  runRepo: runRepoMock,
  secrets: {},
  userRepo: {},
}));

vi.mock('./sandbox-lifecycle.js', () => lifecycleMock);

import { MAX_SANDBOX_RUN_MINUTES, sweepStuckSandboxRuns } from './sandbox-sweeper.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';
const SUB = 'cog-sub-abc';
const NOW = new Date('2026-05-16T18:00:00.000Z');

const stuckRun = {
  id: RUN_ID,
  agentId: AGENT_ID,
  ownerSub: SUB,
  status: 'running',
  kind: 'sandbox',
  createdAt: '2026-05-16T12:00:00.000Z',
  reservedUsd: 0.006,
};

beforeEach(() => {
  runRepoMock.listStuckSandboxRuns.mockReset().mockResolvedValue([]);
  lifecycleMock.finalizeSandboxRun.mockReset().mockResolvedValue(undefined);
});

describe('sweepStuckSandboxRuns', () => {
  it('queries with a cutoff MAX_SANDBOX_RUN_MINUTES before now', async () => {
    await sweepStuckSandboxRuns(NOW);
    const cutoff = runRepoMock.listStuckSandboxRuns.mock.calls[0]![0] as string;
    const expected = new Date(NOW.getTime() - MAX_SANDBOX_RUN_MINUTES * 60_000).toISOString();
    expect(cutoff).toBe(expected);
  });

  it('finalizes each wedged run through finalizeSandboxRun as a timed-out run', async () => {
    runRepoMock.listStuckSandboxRuns.mockResolvedValue([stuckRun]);
    const result = await sweepStuckSandboxRuns(NOW);
    expect(result).toEqual({ found: 1, finalized: 1 });
    expect(lifecycleMock.finalizeSandboxRun).toHaveBeenCalledTimes(1);
    const input = lifecycleMock.finalizeSandboxRun.mock.calls[0]![0];
    expect(input).toMatchObject({ agentId: AGENT_ID, runId: RUN_ID, exitCode: null });
    // The synthetic reason carries the timeout marker so finalize maps it to timed_out.
    expect(input.stoppedReason).toContain('timed out');
    // Elapsed wall-clock from createdAt to now (6h) is the best-effort duration.
    expect(input.durationMs).toBe(NOW.getTime() - new Date(stuckRun.createdAt).getTime());
  });

  it('is a no-op when nothing is wedged', async () => {
    const result = await sweepStuckSandboxRuns(NOW);
    expect(result).toEqual({ found: 0, finalized: 0 });
    expect(lifecycleMock.finalizeSandboxRun).not.toHaveBeenCalled();
  });

  it('stays idempotent on redelivery: finalizeSandboxRun settles a re-swept run without re-charging', async () => {
    // The real lifecycle path is idempotent (atomic reservation claim); the
    // sweeper simply hands the run to it again. A second sweep of the same run
    // must not throw or double-invoke per run.
    runRepoMock.listStuckSandboxRuns.mockResolvedValue([stuckRun]);
    await sweepStuckSandboxRuns(NOW);
    await sweepStuckSandboxRuns(NOW);
    expect(lifecycleMock.finalizeSandboxRun).toHaveBeenCalledTimes(2);
    for (const call of lifecycleMock.finalizeSandboxRun.mock.calls) {
      expect(call[0]).toMatchObject({ agentId: AGENT_ID, runId: RUN_ID });
    }
  });

  it('skips a run that fails to finalize and still processes the rest of the batch', async () => {
    const other = { ...stuckRun, id: '01HZAAAAAAAAAAAAAAAAAAAAAA' };
    runRepoMock.listStuckSandboxRuns.mockResolvedValue([stuckRun, other]);
    lifecycleMock.finalizeSandboxRun
      .mockRejectedValueOnce(new Error('dynamo down'))
      .mockResolvedValueOnce(undefined);
    const result = await sweepStuckSandboxRuns(NOW);
    expect(result).toEqual({ found: 2, finalized: 1 });
    expect(lifecycleMock.finalizeSandboxRun).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { agentRepoMock, runRepoMock, watchdogMock } = vi.hoisted(() => ({
  agentRepoMock: { releaseActiveRun: vi.fn() },
  runRepoMock: { getOne: vi.fn(), patchRun: vi.fn() },
  watchdogMock: { deleteRunWatchdog: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  runRepo: runRepoMock,
  secrets: {},
  userRepo: {},
}));

vi.mock('./sandbox-watchdog.js', () => watchdogMock);

import { finalizeSandboxRun } from './sandbox-lifecycle.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';
const SUB = 'cog-sub-abc';

const existing = {
  id: RUN_ID,
  agentId: AGENT_ID,
  ownerSub: SUB,
  createdAt: '2026-05-16T12:00:00.000Z',
};

beforeEach(() => {
  agentRepoMock.releaseActiveRun.mockReset().mockResolvedValue(undefined);
  runRepoMock.getOne.mockReset().mockResolvedValue(existing);
  runRepoMock.patchRun.mockReset().mockResolvedValue(undefined);
  watchdogMock.deleteRunWatchdog.mockReset().mockResolvedValue(undefined);
});

describe('finalizeSandboxRun', () => {
  it('maps exit code 0 to ok and releases the slot', async () => {
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 0, durationMs: 5000 });
    const patch = runRepoMock.patchRun.mock.calls[0]!;
    expect(patch[1]).toBe(existing.createdAt);
    expect(patch[3]).toMatchObject({ status: 'ok', exitCode: 0, durationMs: 5000, error: null });
    expect(agentRepoMock.releaseActiveRun).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      ownerSub: SUB,
      runId: RUN_ID,
    });
  });

  it('maps a non-zero exit code to error', async () => {
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 1, durationMs: 10 });
    expect(runRepoMock.patchRun.mock.calls[0]![3]).toMatchObject({
      status: 'error',
      error: 'exit code 1',
    });
  });

  it('maps a timeout stoppedReason to timed_out', async () => {
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: null,
      stoppedReason: 'Task stopped because it timed out',
      durationMs: 100,
    });
    expect(runRepoMock.patchRun.mock.calls[0]![3]).toMatchObject({ status: 'timed_out' });
    expect(agentRepoMock.releaseActiveRun).toHaveBeenCalled();
  });

  it('maps the in-container timeout exit code (124) to timed_out', async () => {
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 124,
      stoppedReason: 'Essential container in task exited',
      durationMs: 100,
    });
    expect(runRepoMock.patchRun.mock.calls[0]![3]).toMatchObject({ status: 'timed_out' });
  });

  it('preserves a mid-run spend_limit_exceeded status (and its error) set by the gateway', async () => {
    runRepoMock.getOne.mockResolvedValue({ ...existing, status: 'spend_limit_exceeded' });
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 1, durationMs: 900 });
    const patch = runRepoMock.patchRun.mock.calls[0]![3];
    expect(patch.status).toBe('spend_limit_exceeded');
    expect(patch).not.toHaveProperty('error');
    expect(patch).toMatchObject({ durationMs: 900, exitCode: 1 });
    expect(agentRepoMock.releaseActiveRun).toHaveBeenCalled();
  });

  it('deletes the run watchdog schedule when the task stops', async () => {
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 0, durationMs: 5000 });
    expect(watchdogMock.deleteRunWatchdog).toHaveBeenCalledWith(RUN_ID);
  });

  it('is a no-op (except watchdog cleanup) when the run cannot be found', async () => {
    runRepoMock.getOne.mockResolvedValue(null);
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 0, durationMs: 1 });
    expect(runRepoMock.patchRun).not.toHaveBeenCalled();
    expect(agentRepoMock.releaseActiveRun).not.toHaveBeenCalled();
    expect(watchdogMock.deleteRunWatchdog).toHaveBeenCalledWith(RUN_ID);
  });
});

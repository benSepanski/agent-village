import { beforeEach, describe, expect, it, vi } from 'vitest';

const { agentRepoMock, runRepoMock, watchdogMock } = vi.hoisted(() => ({
  agentRepoMock: { releaseActiveRun: vi.fn(), finalizeSpend: vi.fn() },
  runRepoMock: {
    getOne: vi.fn(),
    patchRun: vi.fn(),
    addRunUsage: vi.fn(),
    claimRunReservation: vi.fn(),
  },
  watchdogMock: { deleteRunWatchdog: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  runRepo: runRepoMock,
  secrets: {},
  userRepo: {},
}));

vi.mock('./sandbox-watchdog.js', () => watchdogMock);

import { actualSandboxCost } from '@agent-village/domain';
import { finalizeSandboxRun } from './sandbox-lifecycle.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';
const SUB = 'cog-sub-abc';

const existing = {
  id: RUN_ID,
  agentId: AGENT_ID,
  ownerSub: SUB,
  createdAt: '2026-05-16T12:00:00.000Z',
  reservedUsd: null as number | null,
};

beforeEach(() => {
  agentRepoMock.releaseActiveRun.mockReset().mockResolvedValue(undefined);
  agentRepoMock.finalizeSpend.mockReset().mockResolvedValue(undefined);
  runRepoMock.getOne.mockReset().mockResolvedValue(existing);
  runRepoMock.patchRun.mockReset().mockResolvedValue(undefined);
  runRepoMock.addRunUsage.mockReset().mockResolvedValue(undefined);
  runRepoMock.claimRunReservation.mockReset().mockResolvedValue(null);
  watchdogMock.deleteRunWatchdog.mockReset().mockResolvedValue(undefined);
  delete process.env['AV_SANDBOX_CPU'];
  delete process.env['AV_SANDBOX_MEMORY'];
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

  it('nulls the gateway token hash on a normal terminal patch (token dies with the run)', async () => {
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 0, durationMs: 5000 });
    expect(runRepoMock.patchRun.mock.calls[0]![3]).toMatchObject({ gatewayTokenHash: null });
  });

  it('nulls the gateway token hash even for a breached run so its token stops authenticating', async () => {
    // Regression: spend_limit_exceeded is both the mid-run breach signal and a
    // terminal status; without this the leaked token stays in the gateway's
    // ACTIVE_RUN_STATUSES forever (ADR 0004).
    runRepoMock.getOne.mockResolvedValue({ ...existing, status: 'spend_limit_exceeded' });
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 1, durationMs: 900 });
    expect(runRepoMock.patchRun.mock.calls[0]![3]).toMatchObject({ gatewayTokenHash: null });
  });

  it('deletes the run watchdog schedule when the task stops', async () => {
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 0, durationMs: 5000 });
    expect(watchdogMock.deleteRunWatchdog).toHaveBeenCalledWith(RUN_ID);
  });

  it('does not re-finalize a run already settled as launch_failed', async () => {
    // onLaunchFailure already patched the status, refunded the reservation,
    // released the slot, and emitted the EMF datapoint; the stop event for the
    // aborted task must not overwrite launch_failed or double-count.
    runRepoMock.getOne.mockResolvedValue({ ...existing, status: 'launch_failed' });
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 1, durationMs: 200 });
    expect(runRepoMock.patchRun).not.toHaveBeenCalled();
    expect(agentRepoMock.releaseActiveRun).not.toHaveBeenCalled();
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

describe('finalizeSandboxRun — persisted run events (Phase 3 step 07)', () => {
  const launched = { event: 'sandbox.run.launched', at: '2026-05-16T12:00:00.000Z' };

  it('appends observed task start/stop and a finalized marker to the run events', async () => {
    runRepoMock.getOne.mockResolvedValue({ ...existing, events: [launched] });
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 0,
      durationMs: 180_000,
      taskStartedAt: '2026-05-16T12:00:20.000Z',
      taskStoppedAt: '2026-05-16T12:03:20.000Z',
    });
    const events = runRepoMock.patchRun.mock.calls[0]![3].events;
    expect(events.map((e: { event: string }) => e.event)).toEqual([
      'sandbox.run.launched',
      'sandbox.run.task_started',
      'sandbox.run.task_stopped',
      'sandbox.run.finalized',
    ]);
    expect(events[1].at).toBe('2026-05-16T12:00:20.000Z');
    expect(events[2].at).toBe('2026-05-16T12:03:20.000Z');
  });

  it('omits task start/stop events when the ECS event lacked timestamps', async () => {
    runRepoMock.getOne.mockResolvedValue({ ...existing, events: [launched] });
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 1, durationMs: 5 });
    const events = runRepoMock.patchRun.mock.calls[0]![3].events;
    expect(events.map((e: { event: string }) => e.event)).toEqual([
      'sandbox.run.launched',
      'sandbox.run.finalized',
    ]);
  });

  it('appends nothing on a redelivered stop event (already finalized)', async () => {
    const done = [launched, { event: 'sandbox.run.finalized', at: '2026-05-16T12:03:22.000Z' }];
    runRepoMock.getOne.mockResolvedValue({ ...existing, events: done });
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 0,
      durationMs: 180_000,
      taskStartedAt: '2026-05-16T12:00:20.000Z',
      taskStoppedAt: '2026-05-16T12:03:20.000Z',
    });
    expect(runRepoMock.patchRun.mock.calls[0]![3].events).toEqual(done);
  });

  it('tolerates legacy runs without an events field', async () => {
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 0,
      durationMs: 100,
      taskStoppedAt: '2026-05-16T12:03:20.000Z',
    });
    const events = runRepoMock.patchRun.mock.calls[0]![3].events;
    expect(events.map((e: { event: string }) => e.event)).toEqual([
      'sandbox.run.task_stopped',
      'sandbox.run.finalized',
    ]);
  });
});

describe('finalizeSandboxRun — compute-spend reconciliation', () => {
  // Default task size (256 CPU / 512 MiB); a 30-minute reservation at ARM64 rates.
  const RESERVED = 0.0049365;
  const DURATION_MS = 180_000; // 3 minutes actual
  const ACTUAL = actualSandboxCost(DURATION_MS, 256, 512);

  beforeEach(() => {
    runRepoMock.getOne.mockResolvedValue({ ...existing, reservedUsd: RESERVED });
    // The reservation is handed out by the atomic claim, not the snapshot.
    runRepoMock.claimRunReservation.mockResolvedValue(RESERVED);
  });

  it('finalizes the agent ledger with actual − reserved and shifts the run costUsd', async () => {
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 0,
      durationMs: DURATION_MS,
    });
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalledTimes(1);
    const ledger = agentRepoMock.finalizeSpend.mock.calls[0]![0];
    expect(ledger).toMatchObject({ agentId: AGENT_ID, ownerSub: SUB });
    expect(ledger.deltaUsd).toBeCloseTo(ACTUAL - RESERVED, 9);
    expect(ledger.deltaUsd).toBeLessThan(0); // early exit refunds most of the flat estimate
    const usage = runRepoMock.addRunUsage.mock.calls[0]!;
    expect(usage[0]).toBe(AGENT_ID);
    expect(usage[2]).toBe(RUN_ID);
    expect(usage[3].costUsd).toBeCloseTo(ACTUAL - RESERVED, 9);
    expect(usage[3]).toMatchObject({ tokensIn: 0, tokensOut: 0 });
  });

  it('settles the reservation via the atomic claim, never via the terminal patch', async () => {
    // A read-then-write marker would double-apply the delta when two stop-event
    // deliveries run concurrently; the conditional claim is the only settler.
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 0,
      durationMs: DURATION_MS,
    });
    expect(runRepoMock.claimRunReservation).toHaveBeenCalledWith(
      AGENT_ID,
      existing.createdAt,
      RUN_ID,
    );
    expect(runRepoMock.patchRun.mock.calls[0]![3]).not.toHaveProperty('reservedUsd');
  });

  it('skips reconciliation when the claim loses (redelivered or concurrent stop event)', async () => {
    runRepoMock.claimRunReservation.mockResolvedValue(null);
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 0, durationMs: 500 });
    expect(agentRepoMock.finalizeSpend).not.toHaveBeenCalled();
    expect(runRepoMock.addRunUsage).not.toHaveBeenCalled();
    expect(agentRepoMock.releaseActiveRun).toHaveBeenCalled();
  });

  it('still finalizes the run when the claim itself fails', async () => {
    runRepoMock.claimRunReservation.mockRejectedValue(new Error('dynamo down'));
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 0, durationMs: 500 });
    expect(agentRepoMock.finalizeSpend).not.toHaveBeenCalled();
    expect(agentRepoMock.releaseActiveRun).toHaveBeenCalled();
  });

  it('charges more than reserved when the task outlived its priced window', async () => {
    const longMs = 3_600_000; // 60 min actual vs 30 min reserved
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 0,
      durationMs: longMs,
    });
    expect(agentRepoMock.finalizeSpend.mock.calls[0]![0].deltaUsd).toBeGreaterThan(0);
  });

  it('applies the one-minute Fargate minimum to an instant crash', async () => {
    await finalizeSandboxRun({ agentId: AGENT_ID, runId: RUN_ID, exitCode: 1, durationMs: 0 });
    const delta = agentRepoMock.finalizeSpend.mock.calls[0]![0].deltaUsd;
    expect(delta).toBeCloseTo(actualSandboxCost(0, 256, 512) - RESERVED, 9);
  });

  it('reconciles breached (spend_limit_exceeded) runs too', async () => {
    runRepoMock.getOne.mockResolvedValue({
      ...existing,
      status: 'spend_limit_exceeded',
      reservedUsd: RESERVED,
    });
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 1,
      durationMs: DURATION_MS,
    });
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalledTimes(1);
    expect(runRepoMock.patchRun.mock.calls[0]![3]).toMatchObject({
      status: 'spend_limit_exceeded',
    });
  });

  it('prices the reconciliation with the env-configured task size', async () => {
    process.env['AV_SANDBOX_CPU'] = '512';
    process.env['AV_SANDBOX_MEMORY'] = '1024';
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 0,
      durationMs: DURATION_MS,
    });
    const delta = agentRepoMock.finalizeSpend.mock.calls[0]![0].deltaUsd;
    expect(delta).toBeCloseTo(actualSandboxCost(DURATION_MS, 512, 1024) - RESERVED, 9);
  });

  it('still finalizes the run and releases the slot when reconciliation fails', async () => {
    agentRepoMock.finalizeSpend.mockRejectedValue(new Error('dynamo down'));
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId: RUN_ID,
      exitCode: 0,
      durationMs: DURATION_MS,
    });
    expect(runRepoMock.patchRun).toHaveBeenCalledTimes(1);
    expect(agentRepoMock.releaseActiveRun).toHaveBeenCalledTimes(1);
  });
});

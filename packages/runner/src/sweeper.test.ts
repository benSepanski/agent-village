import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runnerMock } = vi.hoisted(() => ({
  runnerMock: { sweepStuckSandboxRuns: vi.fn() },
}));

vi.mock('@agent-village/services', () => ({ runner: runnerMock }));

import { handler } from './sweeper.js';

beforeEach(() => {
  runnerMock.sweepStuckSandboxRuns.mockReset().mockResolvedValue({ found: 0, finalized: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sweeper handler', () => {
  it('invokes the stuck-run sweep', async () => {
    await handler();
    expect(runnerMock.sweepStuckSandboxRuns).toHaveBeenCalledTimes(1);
  });

  it('rethrows so a failed sweep surfaces as a Lambda error', async () => {
    runnerMock.sweepStuckSandboxRuns.mockRejectedValue(new Error('scan failed'));
    await expect(handler()).rejects.toThrow('scan failed');
  });
});

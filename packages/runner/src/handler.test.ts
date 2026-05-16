import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runnerMock } = vi.hoisted(() => ({
  runnerMock: { executeRun: vi.fn() },
}));

vi.mock('@agent-village/services', () => ({ runner: runnerMock }));

import { handler } from './handler.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';

beforeEach(() => {
  runnerMock.executeRun.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runner handler', () => {
  it('returns the run id and status on success', async () => {
    runnerMock.executeRun.mockResolvedValue({ runId: RUN_ID, status: 'ok' });
    const result = await handler({ agentId: AGENT_ID });
    expect(result).toEqual({ runId: RUN_ID, status: 'ok' });
    expect(runnerMock.executeRun).toHaveBeenCalledWith({ agentId: AGENT_ID });
  });

  it('rejects a payload without agentId (logs agent.run.failed)', async () => {
    await expect(handler({})).rejects.toThrow(/ULID|agentId/);
    expect(runnerMock.executeRun).not.toHaveBeenCalled();
  });

  it('rejects a payload with non-ULID agentId', async () => {
    await expect(handler({ agentId: 'not-a-ulid' })).rejects.toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpendLimitExceededError, UserBudgetExceededError } from '@agent-village/domain';

const { agentRepoMock } = vi.hoisted(() => ({
  agentRepoMock: { reserveSpend: vi.fn(), finalizeSpend: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({ agentRepo: agentRepoMock }));

import { logger } from './logger.js';
import { reserveInlineSpend, refundInlineReservation } from './runner-spend.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';
const SUB = 'cog-sub-abc';

const logCtx = { agentId: AGENT_ID, runId: RUN_ID, traceId: 'trace-1' } as never;
const agent = { id: AGENT_ID, ownerSub: SUB } as never;

beforeEach(() => {
  agentRepoMock.reserveSpend.mockReset();
  agentRepoMock.finalizeSpend.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reserveInlineSpend', () => {
  it('reserves and returns true on success, omitting userBudget when unset', async () => {
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    const ok = await reserveInlineSpend(logCtx, agent, 0.05, undefined);
    expect(ok).toBe(true);
    expect(agentRepoMock.reserveSpend.mock.calls[0]![0]).not.toHaveProperty('userBudget');
  });

  it('includes the userBudget leg when set', async () => {
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    const leg = { windowKey: 'BUDGET#2026-07', limitUsd: 50, now: '2026-07-01T00:00:00.000Z' };
    await reserveInlineSpend(logCtx, agent, 0.05, leg);
    expect(agentRepoMock.reserveSpend).toHaveBeenCalledWith(
      expect.objectContaining({ userBudget: leg }),
    );
  });

  it('returns false (and logs agent.run.spend_rejected) on an agent-cap rejection', async () => {
    agentRepoMock.reserveSpend.mockRejectedValue(
      new SpendLimitExceededError({
        agentId: AGENT_ID,
        spendLimitUsd: 1,
        spendUsedUsd: 1,
        estimateUsd: 0.01,
      }),
    );
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation((() => {}) as never);
    const ok = await reserveInlineSpend(logCtx, agent, 0.01, undefined);
    expect(ok).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'agent.run.spend_rejected' }),
    );
  });

  it('returns false (and logs agent.run.budget_rejected) on a user-budget rejection', async () => {
    agentRepoMock.reserveSpend.mockRejectedValue(
      new UserBudgetExceededError({
        ownerSub: SUB,
        windowKey: 'BUDGET#2026-07',
        budgetLimitUsd: 50,
        spentUsd: 50,
        estimateUsd: 0.01,
      }),
    );
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation((() => {}) as never);
    const ok = await reserveInlineSpend(logCtx, agent, 0.01, undefined);
    expect(ok).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'agent.run.budget_rejected' }),
    );
  });

  it('rethrows an unrelated error', async () => {
    agentRepoMock.reserveSpend.mockRejectedValue(new Error('dynamo down'));
    await expect(reserveInlineSpend(logCtx, agent, 0.01, undefined)).rejects.toThrow('dynamo down');
  });
});

describe('refundInlineReservation', () => {
  it('refunds the estimate, omitting userWindowKey when unset', async () => {
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
    await refundInlineReservation(logCtx, agent, 0.05, undefined);
    const call = agentRepoMock.finalizeSpend.mock.calls[0]![0];
    expect(call.deltaUsd).toBeCloseTo(-0.05, 9);
    expect(call).not.toHaveProperty('userWindowKey');
  });

  it('includes userWindowKey when set', async () => {
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
    await refundInlineReservation(logCtx, agent, 0.05, 'BUDGET#2026-07');
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalledWith(
      expect.objectContaining({ userWindowKey: 'BUDGET#2026-07' }),
    );
  });

  it('logs (never throws) when the refund write itself fails', async () => {
    agentRepoMock.finalizeSpend.mockRejectedValue(new Error('dynamo down'));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation((() => {}) as never);
    await expect(refundInlineReservation(logCtx, agent, 0.05, undefined)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'agent.run.spend_refund_failed' }),
    );
  });
});

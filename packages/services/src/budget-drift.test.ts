import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { agentRepoMock, userRepoMock, budgetRepoMock, runRepoMock } = vi.hoisted(() => ({
  agentRepoMock: { listAllAgents: vi.fn() },
  userRepoMock: { listAllProfiles: vi.fn() },
  budgetRepoMock: { getWindow: vi.fn() },
  runRepoMock: { sumAgentLifetimeCost: vi.fn(), sumUserMonthCost: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  userRepo: userRepoMock,
  budgetRepo: budgetRepoMock,
  runRepo: runRepoMock,
}));

import { logger } from './logger.js';
import { checkBudgetDrift, driftThresholdUsd } from './budget-drift.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const SUB = 'cog-sub-abc';
const NOW = new Date('2026-07-21T12:00:00.000Z');

beforeEach(() => {
  Object.values(agentRepoMock).forEach((m) => m.mockReset());
  Object.values(userRepoMock).forEach((m) => m.mockReset());
  Object.values(budgetRepoMock).forEach((m) => m.mockReset());
  Object.values(runRepoMock).forEach((m) => m.mockReset());
  agentRepoMock.listAllAgents.mockResolvedValue([]);
  userRepoMock.listAllProfiles.mockResolvedValue([]);
  delete process.env['AV_BUDGET_DRIFT_THRESHOLD_USD'];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('driftThresholdUsd', () => {
  it('defaults to 0.5 when unset', () => {
    expect(driftThresholdUsd()).toBe(0.5);
  });

  it('honors a valid env override', () => {
    process.env['AV_BUDGET_DRIFT_THRESHOLD_USD'] = '2';
    expect(driftThresholdUsd()).toBe(2);
  });

  it('falls back to the default for a non-numeric override', () => {
    process.env['AV_BUDGET_DRIFT_THRESHOLD_USD'] = 'lots';
    expect(driftThresholdUsd()).toBe(0.5);
  });
});

describe('checkBudgetDrift', () => {
  it('reports zero drift and zero detections with nothing to check', async () => {
    const result = await checkBudgetDrift(NOW, 0.5);
    expect(result).toEqual({ agentsChecked: 0, usersChecked: 0, maxDriftUsd: 0, detected: 0 });
  });

  it('recomputes an agent lifetime accumulator and reports its drift', async () => {
    agentRepoMock.listAllAgents.mockResolvedValue([
      { id: AGENT_ID, spendUsedUsd: 5, ownerSub: SUB },
    ]);
    runRepoMock.sumAgentLifetimeCost.mockResolvedValue({ costUsd: 4, inFlightReservedUsd: 0.5 });
    const result = await checkBudgetDrift(NOW, 0.1);
    expect(runRepoMock.sumAgentLifetimeCost).toHaveBeenCalledWith(AGENT_ID);
    expect(result.agentsChecked).toBe(1);
    expect(result.maxDriftUsd).toBeCloseTo(0.5, 9); // 5 - (4 + 0.5)
    expect(result.detected).toBe(1); // exceeds the 0.1 threshold
  });

  it('does not flag an agent whose drift is within the threshold', async () => {
    agentRepoMock.listAllAgents.mockResolvedValue([
      { id: AGENT_ID, spendUsedUsd: 5, ownerSub: SUB },
    ]);
    runRepoMock.sumAgentLifetimeCost.mockResolvedValue({ costUsd: 5, inFlightReservedUsd: 0 });
    const result = await checkBudgetDrift(NOW, 0.5);
    expect(result.detected).toBe(0);
  });

  it('skips users with no live monthly budget entirely (no window/summary lookup)', async () => {
    userRepoMock.listAllProfiles.mockResolvedValue([{ cognitoSub: SUB }]);
    const result = await checkBudgetDrift(NOW, 0.5);
    expect(budgetRepoMock.getWindow).not.toHaveBeenCalled();
    expect(runRepoMock.sumUserMonthCost).not.toHaveBeenCalled();
    expect(result.usersChecked).toBe(1);
    expect(result.detected).toBe(0);
  });

  it('recomputes a budgeted user window accumulator and reports its drift', async () => {
    // getWindow/sumUserMonthCost are mocked identically for every call, so a
    // drift-exceeding value here fires for BOTH the current- and
    // prior-month checks the sweep now performs (MINOR 4 fix) — hence
    // detected: 2, not 1.
    userRepoMock.listAllProfiles.mockResolvedValue([{ cognitoSub: SUB, userMonthlyBudgetUsd: 50 }]);
    budgetRepoMock.getWindow.mockResolvedValue({ spentUsd: 10 });
    runRepoMock.sumUserMonthCost.mockResolvedValue({ costUsd: 8, inFlightReservedUsd: 0 });
    const result = await checkBudgetDrift(NOW, 0.5);
    expect(budgetRepoMock.getWindow).toHaveBeenCalledWith(SUB, NOW);
    expect(runRepoMock.sumUserMonthCost).toHaveBeenCalledWith(SUB, NOW);
    expect(result.maxDriftUsd).toBeCloseTo(2, 9); // 10 - 8
    expect(result.detected).toBe(2);
  });

  it('treats a never-created window (null) as zero persisted spend', async () => {
    userRepoMock.listAllProfiles.mockResolvedValue([{ cognitoSub: SUB, userMonthlyBudgetUsd: 50 }]);
    budgetRepoMock.getWindow.mockResolvedValue(null);
    runRepoMock.sumUserMonthCost.mockResolvedValue({ costUsd: 0, inFlightReservedUsd: 0 });
    const result = await checkBudgetDrift(NOW, 0.5);
    expect(result.detected).toBe(0);
    expect(result.maxDriftUsd).toBe(0);
  });

  it("also reconciles the immediately-preceding UTC month's window (settle-lag grace period)", async () => {
    // A run pinned to June's window can settle after the calendar rolls into
    // July; the current-month-only sweep would never re-check June once July
    // starts. Distinguish the two months' mocked data by the `now` argument
    // each repo call receives, so this proves BOTH months are actually
    // queried — not just that the current month is checked twice.
    const PRIOR_MONTH = new Date('2026-06-01T00:00:00.000Z');
    userRepoMock.listAllProfiles.mockResolvedValue([{ cognitoSub: SUB, userMonthlyBudgetUsd: 50 }]);
    budgetRepoMock.getWindow.mockImplementation((_sub: string, date: Date) =>
      Promise.resolve(date.getTime() === NOW.getTime() ? { spentUsd: 5 } : { spentUsd: 20 }),
    );
    runRepoMock.sumUserMonthCost.mockImplementation((_sub: string, date: Date) =>
      Promise.resolve(
        date.getTime() === NOW.getTime()
          ? { costUsd: 5, inFlightReservedUsd: 0 } // current month: no drift
          : { costUsd: 12, inFlightReservedUsd: 0 }, // prior month: drift 8
      ),
    );
    const result = await checkBudgetDrift(NOW, 0.5);
    expect(budgetRepoMock.getWindow).toHaveBeenCalledWith(SUB, NOW);
    expect(budgetRepoMock.getWindow).toHaveBeenCalledWith(SUB, PRIOR_MONTH);
    expect(runRepoMock.sumUserMonthCost).toHaveBeenCalledWith(SUB, PRIOR_MONTH);
    expect(result.maxDriftUsd).toBeCloseTo(8, 9); // 20 - 12, from the prior month
    expect(result.detected).toBe(1); // only the prior-month scope exceeded 0.5
  });

  it('checks every agent and user independently and reports the largest drift', async () => {
    agentRepoMock.listAllAgents.mockResolvedValue([
      { id: AGENT_ID, spendUsedUsd: 5, ownerSub: SUB },
    ]);
    runRepoMock.sumAgentLifetimeCost.mockResolvedValue({ costUsd: 1, inFlightReservedUsd: 0 }); // drift 4
    userRepoMock.listAllProfiles.mockResolvedValue([{ cognitoSub: SUB, userMonthlyBudgetUsd: 50 }]);
    budgetRepoMock.getWindow.mockResolvedValue({ spentUsd: 10 });
    runRepoMock.sumUserMonthCost.mockResolvedValue({ costUsd: 9.9, inFlightReservedUsd: 0 }); // drift 0.1
    const result = await checkBudgetDrift(NOW, 0.5);
    expect(result.agentsChecked).toBe(1);
    expect(result.usersChecked).toBe(1);
    expect(result.maxDriftUsd).toBeCloseTo(4, 9);
    expect(result.detected).toBe(1); // only the agent exceeded 0.5
  });

  it('emits budget.drift.checked and budget.drift.completed, never writing a correction', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation((() => {}) as never);
    agentRepoMock.listAllAgents.mockResolvedValue([
      { id: AGENT_ID, spendUsedUsd: 5, ownerSub: SUB },
    ]);
    runRepoMock.sumAgentLifetimeCost.mockResolvedValue({ costUsd: 5, inFlightReservedUsd: 0 });
    await checkBudgetDrift(NOW, 0.5);
    const events = infoSpy.mock.calls.map((c) => (c[0] as Record<string, unknown>)['event']);
    expect(events).toContain('budget.drift.checked');
    expect(events).toContain('budget.drift.completed');
    infoSpy.mockRestore();
  });
});

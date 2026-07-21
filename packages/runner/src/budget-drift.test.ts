import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { budgetDriftMock } = vi.hoisted(() => ({
  budgetDriftMock: { checkBudgetDrift: vi.fn() },
}));

vi.mock('@agent-village/services', () => ({ budgetDrift: budgetDriftMock }));

import { handler } from './budget-drift.js';

beforeEach(() => {
  budgetDriftMock.checkBudgetDrift
    .mockReset()
    .mockResolvedValue({ agentsChecked: 0, usersChecked: 0, maxDriftUsd: 0, detected: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('budget-drift handler', () => {
  it('invokes the drift-reconciliation pass', async () => {
    await handler();
    expect(budgetDriftMock.checkBudgetDrift).toHaveBeenCalledTimes(1);
  });

  it('rethrows so a failed pass surfaces as a Lambda error', async () => {
    budgetDriftMock.checkBudgetDrift.mockRejectedValue(new Error('scan failed'));
    await expect(handler()).rejects.toThrow('scan failed');
  });
});

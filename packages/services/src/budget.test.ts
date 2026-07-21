import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { userRepoMock, budgetRepoMock, agentRepoMock } = vi.hoisted(() => ({
  userRepoMock: {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
  },
  budgetRepoMock: {
    getWindow: vi.fn(),
  },
  agentRepoMock: {
    listMyAgents: vi.fn(),
  },
}));

vi.mock('@agent-village/data', () => ({
  userRepo: userRepoMock,
  budgetRepo: budgetRepoMock,
  agentRepo: agentRepoMock,
}));

import {
  SpendLimitExceededError,
  UserBudgetExceededError,
  UserNotFoundError,
} from '@agent-village/domain';
import {
  classifySpendRejection,
  getBudgetStatus,
  resolveUserBudgetLeg,
  updateUserBudget,
} from './budget.js';

const SUB = 'cog-sub-abc';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const NOW = new Date('2026-07-21T12:00:00.000Z');

const profileFixture = {
  cognitoSub: SUB,
  email: 'ben@example.com',
  displayName: 'Ben',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  Object.values(userRepoMock).forEach((m) => m.mockReset());
  Object.values(budgetRepoMock).forEach((m) => m.mockReset());
  Object.values(agentRepoMock).forEach((m) => m.mockReset());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getBudgetStatus', () => {
  it('throws UserNotFoundError when the profile does not exist', async () => {
    userRepoMock.getProfile.mockResolvedValue(null);
    await expect(getBudgetStatus(SUB, NOW)).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('reports null limit/remaining and zero usage when no budget is set', async () => {
    userRepoMock.getProfile.mockResolvedValue(profileFixture);
    budgetRepoMock.getWindow.mockResolvedValue(null);
    agentRepoMock.listMyAgents.mockResolvedValue([
      { id: AGENT_ID, name: 'Daily', spendLimitUsd: 1, spendUsedUsd: 0.2 },
    ]);
    const status = await getBudgetStatus(SUB, NOW);
    expect(status).toEqual({
      month: '2026-07',
      limitUsd: null,
      usedUsd: 0,
      remainingUsd: null,
      agents: [{ agentId: AGENT_ID, name: 'Daily', spendLimitUsd: 1, spendUsedUsd: 0.2 }],
    });
  });

  it('computes remaining from the live cap and the current-month window', async () => {
    userRepoMock.getProfile.mockResolvedValue({ ...profileFixture, userMonthlyBudgetUsd: 50 });
    budgetRepoMock.getWindow.mockResolvedValue({
      ownerSub: SUB,
      month: '2026-07',
      spentUsd: 12.5,
      budgetLimitUsd: 50,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    agentRepoMock.listMyAgents.mockResolvedValue([]);
    const status = await getBudgetStatus(SUB, NOW);
    expect(status).toEqual({
      month: '2026-07',
      limitUsd: 50,
      usedUsd: 12.5,
      remainingUsd: 37.5,
      agents: [],
    });
  });

  it('clamps a momentarily negative window balance at zero usage', async () => {
    userRepoMock.getProfile.mockResolvedValue({ ...profileFixture, userMonthlyBudgetUsd: 50 });
    budgetRepoMock.getWindow.mockResolvedValue({
      ownerSub: SUB,
      month: '2026-07',
      spentUsd: -0.01,
      budgetLimitUsd: 50,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    agentRepoMock.listMyAgents.mockResolvedValue([]);
    const status = await getBudgetStatus(SUB, NOW);
    expect(status.usedUsd).toBe(0);
    expect(status.remainingUsd).toBe(50);
  });
});

describe('updateUserBudget', () => {
  it('sets the cap and returns the updated profile', async () => {
    userRepoMock.updateProfile.mockResolvedValue({ ...profileFixture, userMonthlyBudgetUsd: 25 });
    const updated = await updateUserBudget(SUB, { userMonthlyBudgetUsd: 25 });
    expect(userRepoMock.updateProfile).toHaveBeenCalledWith({
      cognitoSub: SUB,
      userMonthlyBudgetUsd: 25,
    });
    expect(updated.userMonthlyBudgetUsd).toBe(25);
  });

  it('clears the cap when given null', async () => {
    userRepoMock.updateProfile.mockResolvedValue(profileFixture);
    await updateUserBudget(SUB, { userMonthlyBudgetUsd: null });
    expect(userRepoMock.updateProfile).toHaveBeenCalledWith({
      cognitoSub: SUB,
      userMonthlyBudgetUsd: null,
    });
  });

  it('is a no-op read when the field is omitted, and 404s if the profile is missing', async () => {
    userRepoMock.getProfile.mockResolvedValue(null);
    await expect(updateUserBudget(SUB, {})).rejects.toBeInstanceOf(UserNotFoundError);
    expect(userRepoMock.updateProfile).not.toHaveBeenCalled();
  });
});

describe('classifySpendRejection', () => {
  it('classifies a UserBudgetExceededError as user_budget', () => {
    const err = new UserBudgetExceededError({
      ownerSub: SUB,
      windowKey: 'BUDGET#2026-07',
      budgetLimitUsd: 50,
      spentUsd: 50,
      estimateUsd: 1,
    });
    expect(classifySpendRejection(err)).toBe('user_budget');
  });

  it('classifies a SpendLimitExceededError as agent_cap', () => {
    const err = new SpendLimitExceededError({
      agentId: AGENT_ID,
      spendLimitUsd: 1,
      spendUsedUsd: 1,
      estimateUsd: 0.01,
    });
    expect(classifySpendRejection(err)).toBe('agent_cap');
  });

  it('returns null for an unrelated error', () => {
    expect(classifySpendRejection(new Error('dynamo down'))).toBeNull();
  });
});

describe('resolveUserBudgetLeg', () => {
  const WINDOW_KEY = 'BUDGET#2026-07';

  it('returns undefined when the owner has no live budget set', async () => {
    userRepoMock.getProfile.mockResolvedValue(profileFixture);
    const leg = await resolveUserBudgetLeg(SUB, WINDOW_KEY, NOW);
    expect(leg).toBeUndefined();
  });

  it('returns undefined when the owner profile does not exist', async () => {
    userRepoMock.getProfile.mockResolvedValue(null);
    const leg = await resolveUserBudgetLeg(SUB, WINDOW_KEY, NOW);
    expect(leg).toBeUndefined();
  });

  it('builds the leg from the live cap and the supplied window key', async () => {
    userRepoMock.getProfile.mockResolvedValue({ ...profileFixture, userMonthlyBudgetUsd: 50 });
    const leg = await resolveUserBudgetLeg(SUB, WINDOW_KEY, NOW);
    expect(leg).toEqual({ windowKey: WINDOW_KEY, limitUsd: 50, now: NOW.toISOString() });
  });
});

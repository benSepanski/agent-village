import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { userRepoMock } = vi.hoisted(() => ({
  userRepoMock: {
    ensureProfile: vi.fn(),
    getProfile: vi.fn(),
  },
}));

vi.mock('@agent-village/data', () => ({
  userRepo: userRepoMock,
  agentRepo: {},
  runRepo: {},
  secrets: {},
}));

import { ensureProfile } from './user.js';

beforeEach(() => {
  userRepoMock.ensureProfile.mockReset();
  userRepoMock.getProfile.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ensureProfile', () => {
  it('forwards Cognito claims to userRepo.ensureProfile and returns the result', async () => {
    const fixture = {
      cognitoSub: 'cog-1',
      email: 'ben@example.com',
      displayName: 'Ben',
      createdAt: '2026-05-16T12:00:00.000Z',
    };
    userRepoMock.ensureProfile.mockResolvedValue(fixture);
    const result = await ensureProfile({ sub: 'cog-1', email: 'ben@example.com', name: 'Ben' });
    expect(result).toBe(fixture);
    expect(userRepoMock.ensureProfile).toHaveBeenCalledWith({
      cognitoSub: 'cog-1',
      email: 'ben@example.com',
      displayName: 'Ben',
    });
  });

  it('uses email as displayName when name is absent', async () => {
    userRepoMock.ensureProfile.mockResolvedValue({});
    await ensureProfile({ sub: 'cog-1', email: 'ben@example.com' });
    expect(userRepoMock.ensureProfile.mock.calls[0]![0].displayName).toBe('ben@example.com');
  });
});

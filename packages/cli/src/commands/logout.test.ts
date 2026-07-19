import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ clearCredentials: vi.fn() }));
vi.mock('../auth.js', () => ({ clearCredentials: mocks.clearCredentials }));

describe('logout', () => {
  it('clears stored credentials and confirms', async () => {
    mocks.clearCredentials.mockResolvedValue(undefined);
    const { logout } = await import('./logout.js');
    const out = await logout();
    expect(mocks.clearCredentials).toHaveBeenCalled();
    expect(out).toContain('signed out');
  });
});

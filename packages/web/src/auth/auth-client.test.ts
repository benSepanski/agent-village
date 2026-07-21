import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentUserMock, fetchAuthSessionMock, signInWithRedirectMock, signOutMock } =
  vi.hoisted(() => ({
    getCurrentUserMock: vi.fn(),
    fetchAuthSessionMock: vi.fn(),
    signInWithRedirectMock: vi.fn(),
    signOutMock: vi.fn(),
  }));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: getCurrentUserMock,
  fetchAuthSession: fetchAuthSessionMock,
  signInWithRedirect: signInWithRedirectMock,
  signOut: signOutMock,
}));

import {
  fetchAuthSession,
  getCurrentUser,
  signInWithRedirect,
  signOut,
  type MockSession,
} from './auth-client.js';

const SESSION: MockSession = {
  userId: 'u1',
  username: 'ben',
  email: 'ben@example.test',
  idToken: 'fake-token',
};

function enableMockMode(session: MockSession = SESSION): void {
  window.__AV_AUTH_MODE__ = 'mock';
  window.__AV_MOCK_SESSION__ = session;
}

beforeEach(() => {
  getCurrentUserMock.mockReset();
  fetchAuthSessionMock.mockReset();
  signInWithRedirectMock.mockReset();
  signOutMock.mockReset();
  delete window.__AV_AUTH_MODE__;
  delete window.__AV_MOCK_SESSION__;
});

afterEach(() => {
  delete window.__AV_AUTH_MODE__;
  delete window.__AV_MOCK_SESSION__;
});

describe('auth-client mock mode', () => {
  it('returns the mock user without calling Amplify', async () => {
    enableMockMode();
    const user = await getCurrentUser();
    expect(user).toEqual({ userId: 'u1', username: 'ben' });
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });

  it('returns a session whose idToken stringifies to the mock token', async () => {
    enableMockMode();
    const session = await fetchAuthSession();
    expect(session.tokens?.idToken?.toString()).toBe('fake-token');
    expect(fetchAuthSessionMock).not.toHaveBeenCalled();
  });

  it('no-ops signInWithRedirect and signOut without touching Amplify', async () => {
    enableMockMode();
    await signInWithRedirect();
    await signOut();
    expect(signInWithRedirectMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('signOut clears the mock session flags', async () => {
    enableMockMode();
    await signOut();
    expect(window.__AV_AUTH_MODE__).toBeUndefined();
    expect(window.__AV_MOCK_SESSION__).toBeUndefined();
  });
});

describe('auth-client real mode (no mock flags set)', () => {
  it('delegates getCurrentUser to Amplify', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'real', username: 'real-user' });
    const user = await getCurrentUser();
    expect(user).toEqual({ userId: 'real', username: 'real-user' });
    expect(getCurrentUserMock).toHaveBeenCalledOnce();
  });

  it('delegates fetchAuthSession to Amplify', async () => {
    fetchAuthSessionMock.mockResolvedValue({ tokens: undefined });
    await fetchAuthSession();
    expect(fetchAuthSessionMock).toHaveBeenCalledOnce();
  });

  it('delegates signInWithRedirect to Amplify with the Google provider', async () => {
    signInWithRedirectMock.mockResolvedValue(undefined);
    await signInWithRedirect();
    expect(signInWithRedirectMock).toHaveBeenCalledWith({ provider: 'Google' });
  });

  it('delegates signOut to Amplify', async () => {
    signOutMock.mockResolvedValue(undefined);
    await signOut();
    expect(signOutMock).toHaveBeenCalledOnce();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const { getCurrentUserMock, signOutMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock('./auth-client.js', () => ({
  getCurrentUser: getCurrentUserMock,
  fetchAuthSession: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: signOutMock,
}));

import { AuthProvider, useAuth } from './AuthProvider.js';

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <p>loading</p>;
  return <p data-testid="user">{user ? user.username : 'anonymous'}</p>;
}

beforeEach(() => {
  getCurrentUserMock.mockReset();
  signOutMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AuthProvider', () => {
  it('renders the signed-in user once Cognito resolves', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'u1', username: 'ben' });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('ben'));
  });

  it('falls back to anonymous when Cognito rejects', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('not signed in'));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('anonymous'));
  });

  it('clears the user on signOut', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'u1', username: 'ben' });
    signOutMock.mockResolvedValue(undefined);
    let signOutFn: () => Promise<void> = async () => undefined;
    function Capture() {
      const ctx = useAuth();
      signOutFn = ctx.signOut;
      return <Probe />;
    }
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('ben'));
    await act(async () => {
      await signOutFn();
    });
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('anonymous'));
  });
});

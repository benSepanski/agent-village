import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

const { getCurrentUserMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
}));

vi.mock('./auth-client.js', () => ({
  getCurrentUser: getCurrentUserMock,
  fetchAuthSession: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
}));

import { AuthProvider } from './AuthProvider.js';
import { ProtectedRoute } from './ProtectedRoute.js';

describe('ProtectedRoute', () => {
  it('shows the protected content when signed in', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'u1', username: 'ben' });
    render(
      <AuthProvider>
        <ProtectedRoute fallback={<p>locked</p>}>
          <p>secret</p>
        </ProtectedRoute>
      </AuthProvider>,
    );
    expect(await screen.findByText('secret')).toBeDefined();
  });

  it('shows the fallback when not signed in', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('nope'));
    render(
      <AuthProvider>
        <ProtectedRoute fallback={<p>locked</p>}>
          <p>secret</p>
        </ProtectedRoute>
      </AuthProvider>,
    );
    expect(await screen.findByText('locked')).toBeDefined();
  });
});

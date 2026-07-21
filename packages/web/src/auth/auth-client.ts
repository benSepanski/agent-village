import {
  fetchAuthSession as amplifyFetchAuthSession,
  getCurrentUser as amplifyGetCurrentUser,
  signInWithRedirect as amplifySignInWithRedirect,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';

/**
 * Auth seam (M4 E2E-WEB). `AuthProvider` and the API client import auth
 * primitives from here instead of `aws-amplify/auth` directly, so Playwright
 * can swap in an in-memory session without a real Cognito pool.
 *
 * Mock mode is activated per-test: the e2e fixture sets `window.__AV_AUTH_MODE__`
 * via `page.addInitScript` before any app script runs, so it is observable on
 * the very first render. `VITE_AV_AUTH_MODE=mock` is a build-time fallback for
 * running the dev server against the mock UI by hand.
 */

export interface MockSession {
  userId: string;
  username: string;
  email: string;
  idToken: string;
}

declare global {
  interface Window {
    __AV_AUTH_MODE__?: 'mock';
    __AV_MOCK_SESSION__?: MockSession;
  }
}

interface ViteAuthEnv {
  VITE_AV_AUTH_MODE?: string;
}

/** Lightweight structural subset of Amplify's `AuthTokens`/`AuthSession`. */
export interface AuthClientTokens {
  idToken?: { toString(): string };
}
export interface AuthClientSession {
  tokens?: AuthClientTokens;
}
export interface AuthClientUser {
  userId: string;
  username: string;
}

function mockModeEnabled(): boolean {
  if (typeof window !== 'undefined' && window.__AV_AUTH_MODE__ === 'mock') return true;
  const env = import.meta.env as ViteAuthEnv;
  return env.VITE_AV_AUTH_MODE === 'mock';
}

function mockSession(): MockSession | null {
  if (!mockModeEnabled()) return null;
  return (typeof window !== 'undefined' ? window.__AV_MOCK_SESSION__ : undefined) ?? null;
}

export async function getCurrentUser(): Promise<AuthClientUser> {
  const mock = mockSession();
  if (mock) return { userId: mock.userId, username: mock.username };
  return amplifyGetCurrentUser();
}

export async function fetchAuthSession(): Promise<AuthClientSession> {
  const mock = mockSession();
  if (mock) return { tokens: { idToken: { toString: () => mock.idToken } } };
  return amplifyFetchAuthSession();
}

export async function signInWithRedirect(): Promise<void> {
  if (mockModeEnabled()) return;
  await amplifySignInWithRedirect({ provider: 'Google' });
}

export async function signOut(): Promise<void> {
  if (mockModeEnabled()) {
    if (typeof window !== 'undefined') {
      delete window.__AV_AUTH_MODE__;
      delete window.__AV_MOCK_SESSION__;
    }
    return;
  }
  await amplifySignOut();
}

import { test as base, expect, type Page } from '@playwright/test';
import type { MockSession } from '../../src/auth/auth-client.js';
import { createMockApiState } from './mock-api-state.js';
import { installApiStubs } from './mock-api-routes.js';

export type { MockSession };

const DEFAULT_SESSION: MockSession = {
  userId: 'e2e-user',
  username: 'e2e@example.test',
  email: 'e2e@example.test',
  // Never a real JWT — the mock API never validates it, and mock mode never
  // reaches a real Cognito or gateway endpoint.
  idToken: 'mock-id-token',
};

/**
 * Fails fast if a real-Cognito run (`AV_E2E_STORAGE_STATE` set) is pointed at
 * anything that looks like the prod environment. Real mode replays a genuine
 * captured session — there is no in-code guard against it hitting prod data
 * once the request leaves the browser, so this check is the only backstop.
 */
function assertNotProd(): void {
  const candidates = [
    process.env['AV_E2E_ENV'],
    process.env['AV_E2E_BASE_URL'],
    process.env['VITE_COGNITO_USER_POOL_ID'],
  ];
  if (candidates.some((v) => v !== undefined && /prod/i.test(v))) {
    throw new Error(
      'Refusing to run authed E2E against a prod-looking target ' +
        '(AV_E2E_ENV/AV_E2E_BASE_URL/VITE_COGNITO_USER_POOL_ID matched /prod/i).',
    );
  }
}

/**
 * Resolved once at module load (before any test in the file runs): the path
 * to a captured real session, or `undefined` for mock mode. Computed as a
 * plain value — not a fixture function — so overriding the built-in
 * `storageState` option doesn't require an (eslint-forbidden) empty
 * destructuring pattern for a fixture with no dependencies.
 */
const REAL_STORAGE_STATE = process.env['AV_E2E_STORAGE_STATE'];
if (REAL_STORAGE_STATE) assertNotProd();

/** Sets the mock-auth flags in the page BEFORE any app script runs. */
async function installMockAuth(page: Page, session: MockSession): Promise<void> {
  await page.addInitScript((s: MockSession) => {
    window.__AV_AUTH_MODE__ = 'mock';
    window.__AV_MOCK_SESSION__ = s;
  }, session);
}

interface AuthedFixtures {
  session: MockSession;
}

/**
 * Signed-in Playwright test (M4 E2E-WEB).
 *
 * Mock mode (default, used by CI): the app's auth calls are swapped for an
 * in-memory session via `window.__AV_AUTH_MODE__`/`__AV_MOCK_SESSION__`
 * (see `src/auth/auth-client.ts`), and every `/agents*` + `/me/budget`
 * request is fulfilled by an in-memory store — fully hermetic, no deployed
 * Cognito or API.
 *
 * Real-Cognito mode: set `AV_E2E_STORAGE_STATE` to a captured Playwright
 * storage-state file (see e2e/README.md) to replay a genuine signed-in
 * session against a real deployed environment instead. In that mode the
 * mock auth/API installation is skipped entirely — real requests, guarded
 * by `assertNotProd`.
 */
export const authedTest = base.extend<AuthedFixtures>({
  session: [DEFAULT_SESSION, { option: true }],
  storageState: REAL_STORAGE_STATE,
  page: async ({ page, session }, use) => {
    if (!REAL_STORAGE_STATE) {
      await installMockAuth(page, session);
      await installApiStubs(page, createMockApiState(session.userId));
    }
    await use(page);
  },
});

export { expect };

import { expect, test } from '@playwright/test';

/**
 * Phase 1 end-to-end happy path.
 *
 * The full sign-in → create agent → Run-now → Replay loop requires a
 * CI-seeded Cognito test user and a deployed dev environment with a
 * matching Anthropic mock-key. Until that fixture is in place, the
 * spec exercises everything that does NOT require an authenticated
 * session, and marks the authenticated portion `.fixme` so it shows
 * up in the report as "not yet implemented" rather than failing CI.
 */

test.describe('Phase 1 MVP', () => {
  test('unauthenticated visitors see the sign-in screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Agent Village' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in with Google/i })).toBeVisible();
  });

  test.fixme('happy path: sign in, create agent, run-now, replay', async ({ page }) => {
    // 1. Sign in with the CI-seeded test user.
    // 2. Land on /; click "+ New agent".
    // 3. Fill the AgentForm (name, model, prompt, */5 cron, $1 limit,
    //    test-Anthropic-key the dev runner recognises).
    // 4. Submit; assert redirect to /agents/{id} and the agent in the table.
    // 5. Click "Run now"; wait for navigate to /agents/{id}/runs/{runId};
    //    assert status pill is "ok" and the timeline shows the canonical
    //    event sequence.
    // 6. Click "Replay"; assert a second Run with the same systemPromptHash.
    await page.goto('/');
  });
});

import { expect, test } from '@playwright/test';
import { authedTest } from './fixtures/auth.js';

/**
 * Phase 1 end-to-end happy path (M4 E2E-WEB).
 *
 * Runs in mock mode by default (no deployed Cognito, no real API — see
 * `fixtures/auth.ts` and `e2e/README.md`), and against a real captured
 * session when `AV_E2E_STORAGE_STATE` is set.
 */

test.describe('Phase 1 MVP', () => {
  test('unauthenticated visitors see the sign-in screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Agent Village' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in with Google/i })).toBeVisible();
  });
});

authedTest.describe('Phase 1 MVP — authenticated', () => {
  authedTest('happy path: sign in, create agent, run-now, replay', async ({ page }) => {
    await page.goto('/');

    // Signed in already (mock or real session) — lands on the agent list.
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await page.getByRole('button', { name: '+ New agent' }).click();

    await expect(page.getByRole('heading', { name: 'New agent' })).toBeVisible();
    await page.getByLabel('Name').fill('E2E test agent');
    await page.getByLabel('System prompt').fill('You are a helpful test agent.');
    await page.getByLabel(/^Schedule/).fill('*/5 * * * *');
    await page.getByLabel('Spend limit USD').fill('1');
    await page.getByLabel('Anthropic API key').fill('sk-ant-e2e-dummy-key');
    await page.getByRole('button', { name: 'Create agent' }).click();

    // Submit navigates to /agents/$agentId once the agent is created.
    await page.waitForURL(/\/agents\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'E2E test agent' })).toBeVisible();
    await expect(page.getByText('No runs yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Run now', exact: true }).click();
    await page.waitForURL(/\/agents\/[^/]+\/runs\/[^/]+$/);
    await expect(page.getByText('ok', { exact: true })).toBeVisible();
    const firstRunUrl = page.url();
    const firstRunId = firstRunUrl.split('/').pop();
    const promptHash = await page.locator('dt:has-text("Prompt hash") + dd code').textContent();

    await page.getByRole('button', { name: 'Replay' }).click();
    // The current URL already matches the /runs/:id pattern, so wait for it
    // to actually change rather than for the (already-satisfied) pattern.
    await page.waitForURL((url) => url.toString() !== firstRunUrl);
    await expect(page.getByText('ok', { exact: true })).toBeVisible();
    // The replay is against the same agent/prompt, so the hash is unchanged —
    // proves the mock (and, in real mode, the server) actually replayed
    // rather than fabricating an unrelated run.
    const replayPromptHash = await page
      .locator('dt:has-text("Prompt hash") + dd code')
      .textContent();
    expect(replayPromptHash).toBe(promptHash);
    // Prompt-hash equality alone can't distinguish "genuinely replayed" from
    // "fresh run of the same agent" (same agent → same hash either way).
    // Assert the server-recorded replayOfRunId actually points back at the
    // first run to prove replay wiring, not just agent identity.
    await expect(page.locator('dt:has-text("Replayed from") + dd code')).toHaveText(
      firstRunId ?? '',
    );
  });
});

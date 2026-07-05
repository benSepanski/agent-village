import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 3 step 09 — live-AWS acceptance runs, driven through the real UI.
 *
 * These scenarios need a deployed environment (real ECS tasks, the metering
 * gateway, the StopTask watchdog), so they are OPT-IN: every test skips unless
 * `E2E_AWS=1`. The same invariants are verified without AWS by
 * `packages/services/src/sandbox-acceptance.test.ts`; this spec exists to
 * exercise them against the genuine article. Setup (seed agents, capture an
 * authenticated storage state, env vars) is documented in ./README.md.
 */

const LIVE = process.env['E2E_AWS'] === '1';
const STORAGE_STATE = process.env['AV_E2E_STORAGE_STATE'];
/** Agent whose manifest app loops Anthropic calls; spendLimitUsd set to breach. */
const BREACH_AGENT_ID = process.env['AV_E2E_BREACH_AGENT_ID'] ?? '';
/** Agent whose manifest command hangs forever; timeoutMinutes set low. */
const HANG_AGENT_ID = process.env['AV_E2E_HANG_AGENT_ID'] ?? '';
/** Optional: the agent's flat launch reservation (from `village agents show`). */
const FLAT_COST_USD = Number(process.env['AV_E2E_FLAT_COST_USD'] ?? Number.NaN);
const RUN_WAIT_MS = Number(process.env['AV_E2E_RUN_WAIT_MS'] ?? 15 * 60_000);
const POLL_MS = 10_000;
const RUN_URL = /\/agents\/[^/]+\/runs\/[0-9A-HJKMNP-TV-Z]{26}$/;

async function startRun(page: Page, agentId: string): Promise<void> {
  await page.goto(`/agents/${agentId}`);
  await page.getByRole('button', { name: 'Run now', exact: true }).click();
  await page.waitForURL(RUN_URL);
}

/** The run page does not poll the run itself — reload until the badge shows. */
async function awaitTerminalBadge(page: Page, label: string): Promise<void> {
  const deadline = Date.now() + RUN_WAIT_MS;
  for (;;) {
    if (await page.getByText(label, { exact: true }).first().isVisible()) return;
    if (Date.now() > deadline) {
      throw new Error(`run did not reach "${label}" within ${RUN_WAIT_MS}ms`);
    }
    await page.waitForTimeout(POLL_MS);
    await page.reload();
  }
}

async function displayedCostUsd(page: Page): Promise<number> {
  const text = (await page.locator('dt:has-text("Cost") + dd').textContent()) ?? '';
  return Number(text.replace('$', ''));
}

test.describe('Phase 3 acceptance — live sandbox runs', () => {
  test.skip(!LIVE, 'set E2E_AWS=1 (and the AV_E2E_* fixtures — see e2e/README.md) to run');
  test.use(STORAGE_STATE ? { storageState: STORAGE_STATE } : {});

  test('forced spend breach stops the app mid-run and the viewer shows actual cost', async ({
    page,
  }) => {
    test.skip(!BREACH_AGENT_ID, 'AV_E2E_BREACH_AGENT_ID not set');
    test.setTimeout(RUN_WAIT_MS + 120_000);
    await startRun(page, BREACH_AGENT_ID);
    await awaitTerminalBadge(page, 'spend-limit');
    // Real persisted lifecycle events, not the old fabricated timeline.
    await expect(page.getByText('sandbox.run.finalized')).toBeVisible();
    const cost = await displayedCostUsd(page);
    expect(cost).toBeGreaterThan(0);
    // Reconciled actual cost, not the flat launch-time reservation.
    if (Number.isFinite(FLAT_COST_USD)) expect(cost).toBeLessThan(FLAT_COST_USD);
  });

  test('forced hang is killed at the manifest timeout', async ({ page }) => {
    test.skip(!HANG_AGENT_ID, 'AV_E2E_HANG_AGENT_ID not set');
    test.setTimeout(RUN_WAIT_MS + 120_000);
    await startRun(page, HANG_AGENT_ID);
    await awaitTerminalBadge(page, 'timed-out');
    await expect(page.getByText('sandbox.run.finalized')).toBeVisible();
    const cost = await displayedCostUsd(page);
    expect(cost).toBeGreaterThan(0);
  });
});

import type { Page } from '@playwright/test';
import { authedTest, expect } from './fixtures/auth.js';

/**
 * Spend-transparency E2E coverage (M7 punch-list #4): the mocked-auth
 * fixtures (`fixtures/auth.ts`, M4) already stand up a hermetic in-memory
 * API, but nothing previously drove `UserBudget`/`UserBudgetForm`/`SpendBar`
 * through a real browser. Runs in mock mode by default — see e2e/README.md.
 */

/**
 * Navigates via the SPA's own client-side routing rather than `page.goto`
 * for `/agents/new` — the mock API stub intercepts every request under
 * `/agents/*` (see `fixtures/mock-api-routes.ts`), so a direct full-page
 * navigation to that path would be swallowed as an (unmatched) API call
 * instead of loading the SPA route.
 */
async function createAgent(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '+ New agent' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('System prompt').fill('You are a helpful test agent.');
  await page.getByLabel('Spend limit USD').fill('1');
  await page.getByLabel('Anthropic API key').fill('sk-ant-e2e-dummy-key');
  await page.getByRole('button', { name: 'Create agent' }).click();
  // Excludes "/agents/new" itself (which also matches a bare
  // `/\/agents\/[^/]+$/`) — otherwise, if the browser hasn't yet navigated
  // away by the time this runs, waitForURL resolves immediately against the
  // still-current /agents/new URL instead of the real post-submit one.
  await page.waitForURL(/\/agents\/(?!new$)[^/]+$/);
}

authedTest.describe('Spend transparency — authenticated', () => {
  authedTest(
    'setting a user budget shows limit, used, and remaining on the agent page',
    async ({ page }) => {
      await createAgent(page, 'Budget display agent');

      // No cap yet: the account-wide budget section shows the "no cap" copy,
      // not a progress bar.
      await expect(page.getByText('No monthly budget set for your account.')).toBeVisible();

      await page.getByLabel('Monthly budget USD').fill('25');
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      // limit + used (SpendBar's progressbar + "$used / $limit" text) — the
      // account-wide budget bar, not the per-agent one above it on the page.
      const bar = page.getByRole('progressbar').last();
      await expect(bar).toHaveAttribute('aria-valuenow', '0');
      await expect(bar).toHaveAttribute('aria-valuemax', '25');
      await expect(page.getByText('$0.0000 / $25.00')).toBeVisible();
      // ...and remaining.
      await expect(page.getByText('$25.00 remaining this month')).toBeVisible();
    },
  );

  authedTest('budget-edit error path surfaces its message inline', async ({ page }) => {
    await createAgent(page, 'Budget error agent');

    await page.route(
      (url) => url.pathname === '/me/budget',
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        return route.fulfill({
          status: 400,
          json: { error: 'userMonthlyBudgetUsd must be finite' },
        });
      },
    );

    await page.getByLabel('Monthly budget USD').fill('25');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText('userMonthlyBudgetUsd must be finite');
    // The failed save must not be reflected as if it succeeded.
    await expect(page.getByText('No monthly budget set for your account.')).toBeVisible();
  });

  authedTest('run-now error path surfaces its message inline', async ({ page }) => {
    await createAgent(page, 'Run-now error agent');
    const agentUrl = page.url();

    await page.route(
      (url) => url.pathname.endsWith('/run-now'),
      (route) =>
        route.fulfill({
          status: 402,
          json: { error: 'spend limit exceeded for agent 01BUDGETERRORAGENT00000000' },
        }),
    );

    await page.getByRole('button', { name: 'Run now', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText('spend limit exceeded');
    // A rejected run-now must not navigate to a (nonexistent) run detail page.
    await expect(page).toHaveURL(agentUrl);
  });
});

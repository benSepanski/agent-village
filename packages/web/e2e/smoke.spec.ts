import { expect, test } from '@playwright/test';

test('SPA loads and shows the harness landing page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Agent Village' })).toBeVisible();
});

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env['AV_E2E_BASE_URL'] ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './packages/web/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env['AV_E2E_NO_SERVER']
    ? undefined
    : {
        command: 'pnpm --filter @agent-village/web dev',
        url: BASE_URL,
        reuseExistingServer: !process.env['CI'],
        timeout: 60_000,
      },
});

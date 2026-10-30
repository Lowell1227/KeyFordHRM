import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: ['70-employee-archive-issues.spec.ts', '61-archive-warnings.spec.ts', '58-employee-create-wizard.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../tmp/employee-archive-issues-20261030/playwright-results',
  use: { baseURL: 'http://127.0.0.1:18779', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 18779 --strictPort',
    url: 'http://127.0.0.1:18779', reuseExistingServer: false,
    env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
});

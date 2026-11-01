import { defineConfig, devices } from '@playwright/test';
process.env.PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:18782';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: ['23-employee-data-review.spec.ts', '58-employee-create-wizard.spec.ts', '61-archive-warnings.spec.ts',
    '62-employee-company-text.spec.ts', '65-contract-subject-maintenance.spec.ts', '70-employee-archive-issues.spec.ts',
    '72-archive-interaction.spec.ts', '73-archive-review-differences.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../tmp/archive-ux-20261101/web-tests.json' }]],
  outputDir: '../tmp/archive-ux-20261101/playwright-results',
  use: { baseURL: 'http://127.0.0.1:18782', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 18782 --strictPort',
    url: 'http://127.0.0.1:18782', reuseExistingServer: false,
    env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' } },
});

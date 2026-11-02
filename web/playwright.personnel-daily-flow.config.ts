import { defineConfig, devices } from '@playwright/test';
process.env.PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:18783';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: ['23-employee-data-review.spec.ts', '54-personnel-resignation-archive.spec.ts',
    '58-employee-create-wizard.spec.ts', '61-archive-warnings.spec.ts', '62-employee-company-text.spec.ts',
    '65-contract-subject-maintenance.spec.ts', '70-employee-archive-issues.spec.ts', '72-archive-interaction.spec.ts',
    '73-archive-review-differences.spec.ts', '74-employee-change-history.spec.ts', '75-personnel-daily-flow.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../tmp/personnel-daily-flow-20261102/web-tests.json' }]],
  outputDir: '../tmp/personnel-daily-flow-20261102/playwright-results',
  use: { baseURL: 'http://127.0.0.1:18783', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 18783 --strictPort',
    url: 'http://127.0.0.1:18783', reuseExistingServer: false,
    env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
});

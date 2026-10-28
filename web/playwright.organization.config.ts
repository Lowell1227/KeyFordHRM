import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: [
    'organization-direct-reports.spec.ts',
    '15-user-management-concepts.spec.ts',
    '23-employee-data-review.spec.ts',
    '54-personnel-resignation-archive.spec.ts',
  ],
  workers: 1,
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:18768', screenshot: 'only-on-failure' },
  outputDir: './test-results/direct-reports',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 18768 --strictPort',
    url: 'http://127.0.0.1:18768',
    reuseExistingServer: false,
  },
});

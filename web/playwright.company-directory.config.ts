import { defineConfig } from '@playwright/test';

// Vite-only component/browser regression. All API calls are intercepted by the specs.
// Deliberately no global setup or shared development/production database.
export default defineConfig({
  testDir: './e2e', testMatch: ['specs/86-company-directory.spec.ts', 'specs/28-confirmation-employee-draft.spec.ts', 'preview/onboarding-validation.spec.ts'],
  workers: 1, retries: 0, timeout: 30000, reporter: 'list',
  outputDir: '../tmp/company-directory/playwright',
  use: { baseURL: 'http://127.0.0.1:18779', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 18779 --strictPort',
    url: 'http://127.0.0.1:18779', reuseExistingServer: false },
});

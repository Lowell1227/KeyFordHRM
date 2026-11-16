import { defineConfig } from '@playwright/test';

// Component/request regressions only. No database or external side effects.
export default defineConfig({
  testDir: './e2e', testMatch: ['specs/68-personnel-reference-data.spec.ts', 'specs/87-personnel-reference-consistency.spec.ts', 'preview/onboarding-validation.spec.ts'],
  workers: 1, retries: 0, timeout: 30000, reporter: 'list',
  outputDir: '../tmp/personnel-consistency/playwright',
  use: { baseURL: 'http://127.0.0.1:18780', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 18780 --strictPort',
    url: 'http://127.0.0.1:18780', reuseExistingServer: false },
});

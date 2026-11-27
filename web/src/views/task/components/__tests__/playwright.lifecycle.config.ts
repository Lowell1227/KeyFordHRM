import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'performance-lifecycle.ui.spec.ts', workers: 1,
  outputDir: '../../../../../test-results/performance-lifecycle-components',
  use: { baseURL: 'http://127.0.0.1:4196', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4196 --strictPort', url: 'http://127.0.0.1:4196', reuseExistingServer: false },
});

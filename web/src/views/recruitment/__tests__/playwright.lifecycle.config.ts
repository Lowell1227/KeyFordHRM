import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'lifecycle-analytics.ui.spec.ts', workers: 1, retries: 0, reporter: 'list',
  outputDir: '../../../../test-results/recruitment-lifecycle-components',
  use: { baseURL: 'http://127.0.0.1:5198', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5198 --strictPort', url: 'http://127.0.0.1:5198', reuseExistingServer: false, timeout: 90000 },
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: '*.ui.spec.ts', workers: 1, retries: 0, reporter: 'list',
  outputDir: '../../../../test-results/recruitment-demand-web',
  use: { baseURL: 'http://127.0.0.1:5197', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5197 --strictPort',
    url: 'http://127.0.0.1:5197', reuseExistingServer: false, timeout: 90000,
  },
});

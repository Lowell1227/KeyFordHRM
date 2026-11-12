import { defineConfig, devices } from '@playwright/test';

// No normal global setup: that setup can prepare data in a different database.
export default defineConfig({
  testDir: './e2e/preview', fullyParallel: false, workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 12000 },
  reporter: [['list']], outputDir: '../test-results/preview',
  use: {
    baseURL: 'http://localhost:5173', trace: 'off', video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});

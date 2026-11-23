import { defineConfig, devices } from '@playwright/test';
const baseURL = process.env.HRM_PREVIEW_URL ?? 'http://localhost:5173';
if (!['http://localhost:5173', 'http://localhost:5174'].includes(baseURL)) throw new Error('Preview verification requires an explicitly supported local-only URL');

// No normal global setup: that setup can prepare data in a different database.
export default defineConfig({
  testDir: './e2e/preview', fullyParallel: false, workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 12000 },
  reporter: [['list']], outputDir: '../test-results/preview',
  use: {
    baseURL, trace: 'off', video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});

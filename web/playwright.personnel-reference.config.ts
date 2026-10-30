import { defineConfig, devices } from '@playwright/test';

// This suite serves the Web app only. Every API request is mocked in the spec.
export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '68-personnel-reference-data.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../tmp/personnel-basic-data-20261030/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:18775',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 18775 --strictPort',
    url: 'http://127.0.0.1:18775',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
});

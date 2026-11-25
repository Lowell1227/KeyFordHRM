import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/specs', testMatch: 'contract-issue-explanations.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/contract-issue-explanations',
  use: { baseURL: 'http://127.0.0.1:18782', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 18782 --strictPort', url: 'http://127.0.0.1:18782',
    reuseExistingServer: false, env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' } },
});

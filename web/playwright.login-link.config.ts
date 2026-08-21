import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: ['19-test-account-quick-login.spec.ts', '20-login-manual-link.spec.ts'],
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});

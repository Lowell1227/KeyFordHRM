import { defineConfig, devices } from '@playwright/test';

if (!/^[a-f0-9]{64}$/.test(process.env.HRM_USABILITY_UI_RUN ?? '')) throw new Error('Use the owned payroll usability harness');
const finalIncrement = process.env.HRM_USABILITY_FINAL_INCREMENT === '1';
export default defineConfig({
  testDir: './e2e/preview', testMatch: 'payroll-usability*.spec.ts', workers: 1, fullyParallel: false, retries: 0,
  timeout: 180000, expect: { timeout: 15000 }, reporter: [['list']], outputDir: '../test-results/payroll-usability-ui/playwright',
  use: { baseURL: 'http://127.0.0.1:5175', actionTimeout: 15000, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'desktop', ...(finalIncrement ? { grep: /API: recovery|scope difference recovery/ } : {}), use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'compact', testIgnore: 'payroll-usability-api.spec.ts', ...(finalIncrement ? { grep: /scope difference recovery/ } : {}), use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    { name: 'mobile', testIgnore: 'payroll-usability-api.spec.ts', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});

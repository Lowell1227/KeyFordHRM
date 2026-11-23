import { defineConfig, devices } from '@playwright/test';

if (!/^[a-f0-9]{64}$/.test(process.env.HRM_READINESS_UI_RUN ?? '')) throw new Error('Start with the run-owned readiness UI harness');
const setupOnly = process.env.HRM_PAYROLL_SETUP_UI === '1';
export default defineConfig({
  testDir: './e2e/preview', testMatch: setupOnly ? 'payroll-setup-ui.spec.ts' : 'payroll-readiness-ui.spec.ts', fullyParallel: false, workers: 1, retries: 0,
  timeout: 180000, expect: { timeout: 20000 }, reporter: [['list']], outputDir: `../test-results/${setupOnly ? 'payroll-setup-ui' : 'payroll-readiness-ui'}/playwright${process.env.HRM_READINESS_UI_COLD === '1' ? '-cold' : ''}`,
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 20000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    ...(setupOnly ? [{ name: 'compact', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } }] : []),
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});

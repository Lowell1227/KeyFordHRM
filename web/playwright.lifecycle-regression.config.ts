import { defineConfig } from '@playwright/test';
import process from 'node:process';
process.env.PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:4196';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: ['67-goal-five-step.spec.ts', '68-goal-changes.spec.ts', '52-improvement-plan-workflow.spec.ts', '28-confirmation-employee-draft.spec.ts'],
  workers: 1, retries: 0, reporter: 'list',
  outputDir: './test-results/performance-lifecycle-regression',
  use: { baseURL: 'http://127.0.0.1:4196', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4196 --strictPort', url: 'http://127.0.0.1:4196', reuseExistingServer: false },
});

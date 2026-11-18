import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: [
    '09-performance-workspace.spec.ts',
    '11-navigation-entrypoints.spec.ts',
    '30-goal-tracking-cycle-closure.spec.ts',
    '68-goal-changes.spec.ts',
  ],
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results/workspace-layout',
  use: { baseURL: 'http://127.0.0.1:5193', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5193 --strictPort',
    url: 'http://127.0.0.1:5193',
    reuseExistingServer: false,
  },
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/specs',
  testMatch: [
    '67-goal-five-step.spec.ts',
    '29-goal-setting-responsive.spec.ts',
    '35-department-review-workflow.spec.ts',
    '41-goal-progress-entry.spec.ts',
    '42-dashboard-multi-cycle.spec.ts',
    '49-performance-specialist.spec.ts',
    '53-prepublication-confirmation.spec.ts',
  ],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4187' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4187',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: true,
  },
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: [
    '12-goal-tracking-model.spec.ts',
    '41-goal-progress-entry.spec.ts',
    '42-ai-service-config.spec.ts',
    '43-ai-progress-confirm.spec.ts',
    '63-performance-card-entry.spec.ts',
    '43-monthly-progress-reference.spec.ts',
    '45-manager-period-context.spec.ts',
    '53-prepublication-confirmation.spec.ts',
  ],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:18438', screenshot: 'only-on-failure' },
  outputDir: '../tmp/qa-dingtalk-performance-cards',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 18438 --strictPort',
    url: 'http://127.0.0.1:18438',
    reuseExistingServer: false,
  },
});

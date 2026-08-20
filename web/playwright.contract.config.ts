import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: [
    '10-team-performance-contract.spec.ts',
    '12-goal-tracking-model.spec.ts',
    '13-cycle-first-performance-context.spec.ts',
    '14-cycle-management-compact.spec.ts',
    '15-user-management-concepts.spec.ts',
    '16-dingtalk-login-error.spec.ts',
    '17-cycle-launch-entry-ux.spec.ts',
    '18-dashboard-report-business-clarity.spec.ts',
    '19-test-account-quick-login.spec.ts',
  ],
  workers: 1,
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
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
    '21-unified-list-workspace.spec.ts',
    '22-template-global-weight-contract.spec.ts',
    '23-employee-data-review.spec.ts',
    '24-dynamic-business-permissions.spec.ts',
    '25-cycle-scoring-plan.spec.ts',
    '26-menu-online-baseline.spec.ts',
    '28-monthly-review-responsive.spec.ts',
    '29-goal-setting-responsive.spec.ts',
    '30-goal-tracking-cycle-closure.spec.ts',
    '31-indicator-visibility-and-map.spec.ts',
    '32-personnel-master-maintenance.spec.ts',
    '33-auth-session-transition.spec.ts',
  ],
  workers: 1,
});

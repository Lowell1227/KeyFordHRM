import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: [
    '10-team-performance-contract.spec.ts',
    '12-goal-tracking-model.spec.ts',
    '13-cycle-first-performance-context.spec.ts',
  ],
  workers: 1,
});

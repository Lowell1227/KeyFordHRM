import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '10-team-performance-contract.spec.ts',
  workers: 1,
});

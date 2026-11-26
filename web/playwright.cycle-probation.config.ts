import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: ['17-cycle-launch-entry-ux.spec.ts', '25-cycle-scoring-plan.spec.ts'],
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results/cycle-probation',
  use: { baseURL: 'http://127.0.0.1:18783', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 18783 --strictPort',
    url: 'http://127.0.0.1:18783',
    reuseExistingServer: false,
    env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
});

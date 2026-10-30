import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/specs', testMatch: ['69-basic-data-integration.spec.ts'], workers: 1, reporter: 'list',
  outputDir: '../tmp/personnel-basic-data-20261030/integration-playwright',
  use: { baseURL: 'http://127.0.0.1:18776' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 18776 --strictPort', url: 'http://127.0.0.1:18776', reuseExistingServer: false, env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' } },
});

import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Isolated component UI checks. Test routes intercept every API; no data preparation.
export default defineConfig({
  testDir: '.', testMatch: 'talent-feedback-*.ui.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../../../test-results/talent-feedback-ui',
  use: { baseURL: 'http://127.0.0.1:5186', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5186 --strictPort',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: 'http://127.0.0.1:5186', reuseExistingServer: true,
    env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
});

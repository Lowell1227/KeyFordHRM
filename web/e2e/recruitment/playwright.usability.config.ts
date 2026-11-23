import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.', testMatch: 'talent-usability.ui.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../../../test-results/recruitment-usability-ui',
  use: { baseURL: 'http://127.0.0.1:5188', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5188 --strictPort',
    cwd: fileURLToPath(new URL('../..', import.meta.url)), url: 'http://127.0.0.1:5188',
    reuseExistingServer: true, env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
});

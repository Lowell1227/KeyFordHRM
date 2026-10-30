import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/specs', testMatch: 'archive-assistant.spec.ts', workers: 1,
  reporter: 'list', outputDir: '../tmp/archive-assistant-playwright',
  use: { baseURL: 'http://127.0.0.1:5189', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort',
    url: 'http://127.0.0.1:5189', reuseExistingServer: false,
    env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1', VITE_API_BASE_URL: '' } },
});

import { defineConfig } from '@playwright/test';

// All requests in these tests are intercepted; no database preparation or live API.
export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '*archive-quality*.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    env: { VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
});

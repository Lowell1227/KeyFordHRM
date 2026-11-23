import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const baseURL = 'http://127.0.0.1:5189';
const apiURL = 'http://127.0.0.1:3007';
for (const [key, expected] of [['PLAYWRIGHT_BASE_URL', baseURL], ['PLAYWRIGHT_API_BASE_URL', apiURL], ['VITE_DEV_PROXY_TARGET', apiURL]]) {
  if (process.env[key] && process.env[key] !== expected) throw new Error('Recruitment backend checks require the dedicated localhost preview');
}

export default defineConfig({
  testDir: '.', testMatch: 'talent-usability.backend.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../../../test-results/recruitment-usability-backend',
  timeout: 120_000,
  use: { baseURL, timezoneId: 'Asia/Shanghai', actionTimeout: 15_000, trace: 'off', video: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort',
    cwd: fileURLToPath(new URL('../..', import.meta.url)), url: baseURL,
    reuseExistingServer: false, env: { VITE_DEV_PROXY_TARGET: apiURL },
  },
});

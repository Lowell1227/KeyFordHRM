import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../..', testMatch: ['**/e2e/recruitment/talent-recruitment.ui.spec.ts', '**/src/views/talent/__tests__/talent-interviews.ui.spec.ts'], workers: 1, retries: 0,
  reporter: 'list', outputDir: '../../../test-results/talent-recruitment-ui',
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
});

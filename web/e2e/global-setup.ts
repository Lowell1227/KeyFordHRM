import { chromium, type FullConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL || 'http://localhost:3000/api/v1';
const WEB_BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const PREPARE_ACCEPTANCE_DATA = !['0', 'false'].includes(
  (process.env.PLAYWRIGHT_PREPARE_ACCEPTANCE_DATA || '').toLowerCase(),
);

interface Role {
  name: string;
  employeeNo: string;
  password: string;
}

const ROLES: Role[] = [
  { name: 'admin', employeeNo: 'ADMIN', password: '000000' },
  { name: 'hr', employeeNo: 'HR001', password: '000000' },
  { name: 'employee', employeeNo: 'EMP001', password: '000000' },
  { name: 'manager', employeeNo: 'MGR001', password: '000000' },
  { name: 'approver', employeeNo: 'VP001', password: '000000' },
];

async function loginAndSaveState(role: Role) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(new URL('/login', WEB_BASE).toString());
  await page.locator('[data-testid="login-employee-no"]').fill(role.employeeNo);
  await page.locator('[data-testid="login-password"]').fill(role.password);
  await page.locator('[data-testid="login-submit"]').click();
  await page.waitForURL(/\/dashboard$/, { timeout: 10000 });

  await context.storageState({ path: `e2e/auth-state/${role.name}.json` });
  await browser.close();
}

function isLoopbackUrl(value: string) {
  const hostname = new URL(value).hostname.toLowerCase();
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

function findRepoRoot() {
  const candidates = [path.resolve(process.cwd(), '..'), process.cwd()];
  const repoRoot = candidates.find((candidate) => existsSync(path.join(candidate, 'docker-compose.yml')));
  if (!repoRoot) throw new Error('Playwright setup could not locate docker-compose.yml');
  return repoRoot;
}

function prepareAcceptanceData() {
  if (!PREPARE_ACCEPTANCE_DATA) {
    console.log('[playwright setup] acceptance data preparation disabled');
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Playwright acceptance data preparation is disabled in production');
  }
  const allowRemote = process.env.PLAYWRIGHT_ALLOW_REMOTE_DATA_SETUP === '1';
  if ((!isLoopbackUrl(API_BASE) || !isLoopbackUrl(WEB_BASE)) && !allowRemote) {
    throw new Error('Refusing to prepare acceptance data for non-local URLs without PLAYWRIGHT_ALLOW_REMOTE_DATA_SETUP=1');
  }

  const repoRoot = findRepoRoot();
  const runInApi = (args: string[]) => execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'api', ...args],
    { cwd: repoRoot, env: process.env, stdio: 'inherit' },
  );

  console.log('[playwright setup] applying API migrations');
  runInApi(['npx', 'prisma', 'migrate', 'deploy']);
  console.log('[playwright setup] seeding idempotent E2E acceptance data');
  runInApi(['npx', 'ts-node', 'prisma/seed-test-data.ts']);
}

async function waitForApiHealth() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) return;
    } catch {
      // The API container may still be starting after migration.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`API health check did not become ready: ${API_BASE}/health`);
}

export default async function globalSetup(_config: FullConfig) {
  await mkdir('e2e/auth-state', { recursive: true });
  prepareAcceptanceData();
  await waitForApiHealth();

  for (const role of ROLES) {
    await loginAndSaveState(role);
  }
}

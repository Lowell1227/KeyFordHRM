import { chromium, FullConfig } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL || 'http://localhost:3000/api/v1';
const WEB_BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';

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

export default async function globalSetup(config: FullConfig) {
  await mkdir('e2e/auth-state', { recursive: true });

  // 后端可能尚未启动，简单轮询 health
  let retries = 30;
  while (retries > 0) {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) break;
    } catch {
      // ignore
    }
    retries--;
    await new Promise((r) => setTimeout(r, 1000));
  }

  for (const role of ROLES) {
    await loginAndSaveState(role);
  }
}

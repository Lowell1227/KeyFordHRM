import { test, expect } from '@playwright/test';
import { ACCEPTANCE_ACCOUNTS, ACCEPTANCE_PASSWORD } from '../fixtures/acceptance-accounts';

const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL || 'http://localhost:3000/api/v1';

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`API ${method} ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function login(employeeNo: string) {
  const data = await api('POST', '/auth/login', undefined, { employeeNo, password: ACCEPTANCE_PASSWORD });
  return data.token as string;
}

async function prepareEmployeeTask() {
  const hrToken = await login(ACCEPTANCE_ACCOUNTS.hr);
  const users = await api('GET', `/users?page=1&pageSize=10&keyword=${ACCEPTANCE_ACCOUNTS.employee}`, hrToken);
  const employee = users.items.find((item: { employeeNo: string }) => item.employeeNo === ACCEPTANCE_ACCOUNTS.employee);
  if (!employee) throw new Error(`${ACCEPTANCE_ACCOUNTS.employee} not found`);
  const tasks = await api('GET', '/tasks?status=manager_scoring&page=1&pageSize=100', hrToken);
  const task = tasks.items.find((item: { employeeId: string }) => item.employeeId === employee.id);
  if (!task) throw new Error(`${ACCEPTANCE_ACCOUNTS.employee} seeded manager-scoring task not found`);
  return task.id as string;
}

test.describe('03-dom-redlines HR pages', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('calibration/approval/reports pages have no coefficient text', async ({ page }) => {
    await page.goto('/calibration');
    await expect(page.locator('text=系数')).not.toBeVisible();

    await page.goto('/approval');
    await expect(page.locator('text=系数')).not.toBeVisible();

    await page.goto('/reports');
    await expect(page.locator('text=系数')).not.toBeVisible();
  });
});

test.describe('03-dom-redlines employee pages', () => {
  test.use({ storageState: 'e2e/auth-state/employee.json' });

  let taskId: string;

  test.beforeAll(async () => {
    taskId = await prepareEmployeeTask();
  });

  test('pre-publish task detail hides manager scores from employee', async ({ page }) => {
    const employeeToken = await login(ACCEPTANCE_ACCOUNTS.employee);
    const taskDetail = await api('GET', `/tasks/${taskId}`, employeeToken);

    await page.goto(`/tasks/${taskId}`);

    expect(taskDetail.totalScore).toBeNull();
    expect(taskDetail.gradeResult).toBeNull();
    for (const inst of taskDetail.indicatorInstances) {
      expect(inst.managerScore).toBeNull();
      expect(inst.finalScore).toBeNull();
    }

    await expect(
      page.getByText('公示结果尚未发布，评分、总分及等级将在公示后开放查看。').first(),
    ).toBeVisible();
    await expect(page.locator('text=系数')).not.toBeVisible();
  });
});

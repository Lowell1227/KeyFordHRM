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

async function fetchAllUsers(token: string) {
  const pageSize = 100;
  const users: { id: string }[] = [];
  let page = 1;
  while (true) {
    const data = await api('GET', `/users?page=${page}&pageSize=${pageSize}`, token);
    users.push(...data.items);
    if (users.length >= data.total || data.items.length === 0) return users;
    page += 1;
  }
}

async function fetchAllTasks(token: string, cycleId: string) {
  const pageSize = 100;
  const tasks: { id: string; employeeId: string }[] = [];
  let page = 1;
  while (true) {
    const data = await api('GET', `/tasks?cycleId=${cycleId}&page=${page}&pageSize=${pageSize}`, token);
    tasks.push(...data.items);
    if (tasks.length >= data.total || data.items.length === 0) return tasks;
    page += 1;
  }
}

function formatRunLabel(value = new Date()): string {
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}`;
}

async function prepareEmployeeTask() {
  const hrToken = await login(ACCEPTANCE_ACCOUNTS.hr);
  const users = await api('GET', `/users?page=1&pageSize=10&keyword=${ACCEPTANCE_ACCOUNTS.employee}`, hrToken);
  const allUsers = await fetchAllUsers(hrToken);
  const employee = users.items[0];
  if (!employee) throw new Error(`${ACCEPTANCE_ACCOUNTS.employee} not found`);
  const userIds = allUsers.map((user) => user.id);

  const runLabel = formatRunLabel();
  await api('POST', '/templates', hrToken, {
    name: `2026年一季度绩效模板（公示前权限验证 ${runLabel}）`,
    applicableDepts: [],
    applicableUsers: userIds,
    maxScore: 100,
    isActive: true,
    dimensions: [
      {
        name: 'KPI',
        type: 'kpi',
        weight: 0.6,
        sortOrder: 0,
        indicators: [{ name: 'KPI A', weight: 1, sortOrder: 0 }],
      },
      {
        name: 'Attitude',
        type: 'attitude',
        weight: 0.4,
        sortOrder: 1,
        indicators: [{ name: 'Attitude A', weight: 1, sortOrder: 0 }],
      },
    ],
  });
  const cycle = await api('POST', '/cycles', hrToken, {
    name: `2026年一季度绩效考核（公示前权限验证 ${runLabel}）`,
    type: 'quarterly',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
  });
  const checked = await api('GET', `/cycles/${cycle.id}/preflight`, hrToken);
  await api('POST', `/cycles/${cycle.id}/launch`, hrToken, { expectedPlanHash: checked.planHash });
  const tasks = await fetchAllTasks(hrToken, cycle.id);
  const task = tasks.find((item) => item.employeeId === employee.id);
  if (!task) throw new Error(`${ACCEPTANCE_ACCOUNTS.employee} task was not created`);
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

    await expect(page.locator('text=计算总分')).not.toBeVisible();
    await expect(page.locator('text=绩效等级')).not.toBeVisible();
    await expect(page.locator('text=系数')).not.toBeVisible();
  });
});

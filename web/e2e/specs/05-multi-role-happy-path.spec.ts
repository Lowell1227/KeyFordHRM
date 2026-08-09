import { expect, test } from '@playwright/test';

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
  if (!res.ok || json.code !== 0) {
    throw new Error(`API ${method} ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function login(employeeNo: string) {
  const data = await api('POST', '/auth/login', undefined, { employeeNo, password: '000000' });
  return data.token as string;
}

async function fetchAll<T>(token: string, path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const data = await api('GET', `${path}${separator}page=${page}&pageSize=100`, token);
    items.push(...data.items);
    if (items.length >= data.total || data.items.length === 0) return items;
  }
}

test.describe('05-multi-role-happy-path', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  test('manager saves a real employee evaluation draft, refreshes, and restores the team workspace URL', async ({ page }) => {
    const [hrToken, managerToken] = await Promise.all([login('HR001'), login('MGR001')]);
    const [allTasks, cycles, managerTasks] = await Promise.all([
      fetchAll<{
        id: string;
        cycleId: string;
        employeeId: string;
        status: string;
      }>(hrToken, '/tasks'),
      fetchAll<{ id: string; name: string }>(hrToken, '/cycles'),
      fetchAll<{
        id: string;
        cycleId: string;
        employeeId: string;
        status: string;
      }>(managerToken, '/tasks/team?stage=manager-eval'),
    ]);
    const acceptanceCycleIds = new Set(
      cycles
        .filter((cycle) => cycle.name.startsWith('E2E-acceptance-'))
        .map((cycle) => cycle.id),
    );
    const target = managerTasks.find(
      (task) => task.status === 'manager_scoring' && acceptanceCycleIds.has(task.cycleId),
    );
    expect(target).toBeTruthy();
    expect(allTasks.some((task) => task.id === target!.id)).toBe(true);

    const detail = await api('GET', `/tasks/${target!.id}`, managerToken);
    expect(detail.status).toBe('manager_scoring');

    const url = `/tasks?scope=team&stage=manager-eval&cycleId=${target!.cycleId}&employeeId=${target!.employeeId}&taskId=${target!.id}`;
    await page.goto(url);
    await expect(page.getByTestId('manager-evaluation-workspace')).toBeVisible();
    await expect(page.getByTestId('team-member-rail')).toBeVisible();
    await page.getByTestId('indicator-expand-all').click();

    const scoreInputs = page.locator('[data-testid^="manager-score-"]');
    await expect(scoreInputs.first()).toBeVisible();
    for (let index = 0; index < await scoreInputs.count(); index += 1) {
      await scoreInputs.nth(index).fill(String(86 + index));
    }
    await page.getByTestId('manager-strengths').fill('Real browser draft acceptance');
    await page.getByTestId('manager-evaluation-save').click();
    await expect(page.getByTestId('manager-evaluation-feedback')).toContainText('草稿已保存');

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`taskId=${target!.id}`));
    await expect(page).toHaveURL(new RegExp(`cycleId=${target!.cycleId}`));
    await expect(page.getByTestId('manager-evaluation-workspace')).toBeVisible();
    await expect(page.getByTestId('manager-strengths')).toHaveValue('Real browser draft acceptance');
    await expect(scoreInputs.first()).toHaveValue('86');

    const teamAfterRefresh = await api('GET', `/tasks/team?stage=manager-eval&cycleId=${target!.cycleId}`, managerToken);
    const permittedEmployeeIds = new Set(teamAfterRefresh.facets.employees.map((employee: { id: string }) => employee.id));
    expect(permittedEmployeeIds.has(target!.employeeId)).toBe(true);
    expect(teamAfterRefresh.items.every((task: { employeeId: string }) => permittedEmployeeIds.has(task.employeeId))).toBe(true);
  });
});

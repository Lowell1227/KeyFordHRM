import { expect, test } from '@playwright/test';
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
  if (!res.ok || json.code !== 0) {
    throw new Error(`API ${method} ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function login(employeeNo: string) {
  const data = await api('POST', '/auth/login', undefined, { employeeNo, password: ACCEPTANCE_PASSWORD });
  return data.token as string;
}

test.describe('07-peripheral-actions HR dialogs', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('HR can open cycle creation dialog', async ({ page }) => {
    await page.goto('/cycles');
    await page.getByTestId('cycle-create').click();
    await expect(page.getByTestId('cycle-create-dialog')).toBeVisible();
  });

  test('HR can open indicator create and import dialogs', async ({ page }) => {
    await page.goto('/indicators');
    await page.getByTestId('indicator-create').click();
    await expect(page.getByTestId('indicator-dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('indicator-import').click();
    await expect(page.getByTestId('indicator-import-dialog')).toBeVisible();
  });

  test('HR can create an indicator from UI', async ({ page }) => {
    const name = `季度销售回款达成率（自动化验证 ${Date.now()}）`;
    await page.goto('/indicators');
    await page.getByTestId('indicator-create').click();
    await page.getByTestId('indicator-name').fill(name);
    await page.getByTestId('indicator-save').click();
    await expect(page.getByTestId('indicator-dialog')).not.toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
  });

  test('HR can open probation review creation dialog', async ({ page }) => {
    await page.goto('/probation-reviews/manage');
    await page.getByTestId('probation-create').click();
    await expect(page.getByTestId('probation-dialog')).toBeVisible();
  });

  test('HR can open confirmation application creation dialog', async ({ page }) => {
    await page.goto('/confirmation-applications/manage');
    await page.getByTestId('confirmation-create').click();
    await expect(page.getByTestId('confirmation-dialog')).toBeVisible();
  });
});

test.describe('07-peripheral-actions objectives and action items', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('HR can open objective and action item creation dialogs', async ({ page }) => {
    await page.goto('/objectives');
    await page.getByTestId('objective-create').click();
    await expect(page.getByTestId('objective-dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    const hrToken = await login(ACCEPTANCE_ACCOUNTS.hr);
    const objective = await api('POST', '/objectives', hrToken, {
      title: `E2E action item objective ${Date.now()}`,
      level: 'company',
      priority: 1,
    });

    await page.goto(`/action-items?objectiveId=${objective.id}`);
    await expect(page.getByTestId('action-item-create')).toBeEnabled();
    await page.getByTestId('action-item-create').click();
    await expect(page.getByTestId('action-item-dialog')).toBeVisible();
  });

  test('HR can create objective and action item from UI', async ({ page }) => {
    const objectiveTitle = `E2E UI objective ${Date.now()}`;
    const itemTitle = `E2E UI action ${Date.now()}`;

    await page.goto('/objectives');
    await page.getByTestId('objective-create').click();
    await page.getByTestId('objective-title').fill(objectiveTitle);
    await page.getByTestId('objective-save').click();
    await expect(page.getByTestId('objective-dialog')).not.toBeVisible();
    await expect(page.getByText(objectiveTitle)).toBeVisible();

    const hrToken = await login(ACCEPTANCE_ACCOUNTS.hr);
    const objectives = await api('GET', '/objectives?flat=true&page=1&pageSize=100', hrToken);
    const objective = objectives.items.find((item: { title: string }) => item.title === objectiveTitle);
    expect(objective).toBeTruthy();

    await page.goto(`/action-items?objectiveId=${objective.id}`);
    await expect(page.getByTestId('action-item-create')).toBeEnabled();
    await page.getByTestId('action-item-create').click();
    await page.getByTestId('action-item-title').fill(itemTitle);
    await page.getByTestId('action-item-save').click();
    await expect(page.getByTestId('action-item-dialog')).not.toBeVisible();
    await expect(page.getByText(itemTitle)).toBeVisible();
  });
});

test.describe('07-peripheral-actions reports', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('HR can access report cycle selector and export entry', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByTestId('report-cycle-select')).toBeVisible();
    await expect(page.getByTestId('report-export')).toBeVisible();
  });

  test('HR report export returns an Excel file', async ({ request }) => {
    const hrToken = await login(ACCEPTANCE_ACCOUNTS.hr);
    const cycles = await api('GET', '/cycles?page=1&pageSize=20', hrToken);
    expect(cycles.items.length).toBeGreaterThan(0);

    const res = await request.get(`${API_BASE}/reports/cycle/${cycles.items[0].id}/export`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('spreadsheetml.sheet');
    const body = await res.body();
    expect(body.length).toBeGreaterThan(1000);
  });
});

import { expect, test } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

interface CycleLaunchMockOptions {
  cycles?: AssessmentCycle[];
  createBodies?: unknown[];
  settingUpdates?: boolean[];
  notificationModeUpdates?: string[];
}

const createdCycle = {
  id: 'cycle-created',
  name: '2026 Q4 季度考核',
  type: 'quarterly',
  startDate: '2026-10-01',
  endDate: '2026-12-31',
  status: 'draft',
  hrOwnerId: 'hr-1',
  participantDeptIds: [],
  participantUserIds: [],
  explicitExemptUserIds: [],
  notificationMode: 'off',
  publishVisibleFields: {},
  gradeAMaxRatio: 0.2,
  gradeBMaxRatio: 0.4,
  gradeCMaxRatio: 0.3,
  gradeDMaxRatio: 0.1,
} satisfies AssessmentCycle;

async function mockCycleLaunchPage(
  page: import('@playwright/test').Page,
  options: CycleLaunchMockOptions = {},
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-cycle-launch-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'hr-1',
      name: '姚瑶',
      employeeNo: 'HR001',
      deptId: 'hr-dept',
      deptName: '人力资源部',
      sysRole: 'hr',
      isAssessorOnly: false,
      canViewAll: true,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: 'sales',
      name: '销售部',
      fullPath: '孚德 / 销售部',
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: 1,
      page: 1,
      pageSize: 50,
      items: [{
        id: 'hr-1',
        name: '姚瑶',
        employeeNo: 'HR001',
        deptId: 'hr-dept',
        deptName: '人力资源部',
        sysRole: 'hr',
        status: 'active',
      }],
    })),
  }));
  await page.route('**/api/v1/templates**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/notification-settings/dingtalk', (route) => {
    const enabled = route.request().method() === 'PATCH'
      ? Boolean(route.request().postDataJSON()?.enabled)
      : false;
    if (route.request().method() === 'PATCH') options.settingUpdates?.push(enabled);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ available: true, enabled, effectiveEnabled: enabled })),
    });
  });
  await page.route('**/api/v1/cycles**', (route) => {
    if (route.request().method() === 'PATCH' && route.request().url().endsWith('/notification-mode')) {
      const notificationMode = String(route.request().postDataJSON()?.notificationMode ?? 'off');
      options.notificationModeUpdates?.push(notificationMode);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ ...createdCycle, notificationMode })),
      });
    }
    if (route.request().method() === 'POST') {
      options.createBodies?.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(createdCycle)),
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: options.cycles?.length ?? 0,
        page: 1,
        pageSize: 10,
        items: options.cycles ?? [],
      })),
    });
  });
}

test.describe('cycle launch entry UX', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('replaces an empty pending table with a launch-oriented action', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId('cycle-group-attention')).toHaveText('待发起');
    await expect(page.getByTestId('cycle-empty-state')).toContainText('暂无待发起周期');
    await expect(page.getByTestId('cycle-empty-create')).toBeVisible();
    await expect(page.locator('.app-pager')).toHaveCount(0);
  });

  test('uses plain launch language and makes company scope explicit', async ({ page }) => {
    const createBodies: unknown[] = [];
    await mockCycleLaunchPage(page, { cycles: [], createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await expect(page.getByRole('dialog', { name: '创建绩效周期' })).toBeVisible();
    await expect(page.getByTestId('cycle-create-flow')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: '全公司' })).toBeChecked();
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('时间节点已联动');
    await expect(page.getByTestId('cycle-create-summary')).toHaveCount(0);
    await expect(page.getByTestId('cycle-create-and-check')).toHaveText('保存并检查');
    await expect(page.getByTestId('cycle-create-impact-hint')).toContainText('不发送钉钉通知');

    await page.getByTestId('cycle-scope-departments').click();
    await page.getByTestId('cycle-scope-department-select').click();
    await page.getByRole('option', { name: '孚德 / 销售部' }).click();
    await page.getByTestId('cycle-create-save-draft').click();

    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({ participantDeptIds: ['sales'] });
  });

  test('shows visible notification controls and keeps a new cycle off by default', async ({ page }) => {
    const createBodies: unknown[] = [];
    await mockCycleLaunchPage(page, { cycles: [], createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await expect(page.getByTestId('cycle-create-flow')).toHaveCount(0);
    await expect(page.getByTestId('cycle-create-summary')).toHaveCount(0);
    await expect(page.getByTestId('dingtalk-notification-status')).toContainText('钉钉通知已关闭');
    await expect(page.getByTestId('cycle-notification-off')).toBeChecked();
    await expect(page.getByTestId('cycle-notification-launch-only')).toBeVisible();
    await expect(page.getByTestId('cycle-notification-reminders')).toBeVisible();

    await page.getByTestId('cycle-create-save-draft').click();
    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({ notificationMode: 'off' });
  });

  test('lets HR turn on the visible DingTalk notification master switch', async ({ page }) => {
    const settingUpdates: boolean[] = [];
    await mockCycleLaunchPage(page, { cycles: [], settingUpdates });
    await page.goto('/cycles?group=attention');

    await page.getByTestId('dingtalk-global-toggle').click();
    await expect.poll(() => settingUpdates).toEqual([true]);
    await expect(page.getByTestId('dingtalk-notification-status')).toContainText('钉钉通知已开启');
  });

  test('lets HR change the notification mode of an existing draft cycle', async ({ page }) => {
    const notificationModeUpdates: string[] = [];
    await mockCycleLaunchPage(page, { cycles: [createdCycle], notificationModeUpdates });
    await page.goto('/cycles?group=attention');

    await page.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '通知设置' }).click();
    const dialog = page.getByRole('dialog', { name: '周期通知设置' });
    await expect(dialog).toBeVisible();
    await dialog.getByText('仅发起提醒一次', { exact: true }).click();
    await dialog.getByRole('button', { name: '保存', exact: true }).click();

    await expect.poll(() => notificationModeUpdates).toEqual(['launch_only']);
  });

  test('links annual type to the next calendar year name and date range', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    const dialog = page.getByRole('dialog', { name: '创建绩效周期' });
    await dialog.locator('.el-select').first().click();
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '年度' }).click();

    await expect(dialog.getByPlaceholder('系统自动生成，可直接修改')).toHaveValue('2027 年度绩效考核');
    await expect(dialog.getByPlaceholder('开始日期')).toHaveValue('2027-01-01');
    await expect(dialog.getByPlaceholder('结束日期')).toHaveValue('2027-12-31');
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('2026-12-22 09:00');
  });

  test('recalculates the default plan when HR changes the cycle type', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    const dialog = page.getByRole('dialog', { name: '创建绩效周期' });
    await dialog.locator('.el-select').first().click();
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '月度' }).click();

    await expect(dialog.getByPlaceholder('系统自动生成，可直接修改')).toHaveValue('2026年09月绩效考核');
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('2026-08-22 09:00');
  });

  test('labels the plan clearly after HR customizes a generated time node', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-create-advanced').click();
    await page.getByTestId('cycle-advanced-schedule').click();

    const goalOpenInput = page.getByTestId('cycle-advanced-fields').locator('.el-date-editor input').first();
    await goalOpenInput.fill('2026-09-20 09:00:00');
    await goalOpenInput.press('Enter');

    await expect(page.getByTestId('cycle-plan-summary')).toContainText('自定义计划');
  });

  test('keeps four advanced groups collapsed with useful summaries', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-create-advanced').click();

    await expect(page.getByTestId('cycle-advanced-participants')).toContainText('全公司');
    await expect(page.getByTestId('cycle-advanced-schedule')).toContainText('默认计划');
    await expect(page.getByTestId('cycle-advanced-grades')).toContainText('A 20%');
    await expect(page.getByTestId('cycle-advanced-publication')).toContainText('4 项可见');
    await expect(page.getByText('目标开放时间', { exact: true })).not.toBeVisible();
    expect(await page.locator('.cycle-create-dialog .el-dialog__body').evaluate((element) => (
      element.scrollWidth <= element.clientWidth
    ))).toBe(true);
  });

  test('keeps advanced settings and the next action usable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    const firstRowColumns = page.getByRole('dialog', { name: '创建绩效周期' }).locator('.el-row').first().locator('.el-col-12');
    const nameColumn = await firstRowColumns.nth(0).boundingBox();
    const typeColumn = await firstRowColumns.nth(1).boundingBox();
    expect(typeColumn?.y).toBeGreaterThanOrEqual((nameColumn?.y ?? 0) + (nameColumn?.height ?? 0) - 1);
    await page.getByTestId('cycle-create-advanced').click();
    await page.getByTestId('cycle-advanced-schedule').click();

    await expect(page.getByText('目标开放时间', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cycle-create-and-check')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const footer = await page.getByTestId('cycle-create-impact-hint').boundingBox();
    expect(footer?.y).toBeGreaterThanOrEqual(0);
    expect((footer?.y ?? 0) + (footer?.height ?? 0)).toBeLessThanOrEqual(844);
  });
});

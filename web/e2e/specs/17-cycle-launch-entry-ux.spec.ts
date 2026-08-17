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
  await page.route('**/api/v1/cycles**', (route) => {
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

  test('explains the preflight step and makes company scope explicit', async ({ page }) => {
    const createBodies: unknown[] = [];
    await mockCycleLaunchPage(page, { cycles: [], createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await expect(page.getByRole('dialog', { name: '创建绩效周期 · 基本信息' })).toBeVisible();
    await expect(page.getByRole('radio', { name: '全公司' })).toBeChecked();
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('周期开始');
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('周期结束');
    await expect(page.getByTestId('cycle-create-and-check')).toHaveText('下一步：开放检查');
    await expect(page.getByTestId('cycle-create-impact-hint')).toContainText('不会立即通知员工');

    await page.getByTestId('cycle-scope-departments').click();
    await page.getByTestId('cycle-scope-department-select').click();
    await page.getByRole('option', { name: '孚德 / 销售部' }).click();
    await page.getByTestId('cycle-create-save-draft').click();

    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({ participantDeptIds: ['sales'] });
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

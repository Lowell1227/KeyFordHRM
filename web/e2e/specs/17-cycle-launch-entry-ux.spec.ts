import { expect, test } from '@playwright/test';
import type { AssessmentCycle, Department } from '../../src/types/api.types';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

interface CycleLaunchMockOptions {
  cycles?: AssessmentCycle[];
  departments?: Department[];
  cycleUrls?: string[];
  createBodies?: unknown[];
  updateBodies?: unknown[];
  departmentUrls?: string[];
  settingUpdates?: boolean[];
  notificationModeUpdates?: string[];
}

const createdCycle = {
  id: 'cycle-created',
  name: '2026 Q4 季度考核',
  type: 'quarterly',
  startDate: '2026-10-01',
  endDate: '2026-12-31',
  goalSettingOpenAt: '2026-09-21T09:00:00.000Z',
  selfEvalOpenAt: '2027-01-01T09:00:00.000Z',
  deadlineIndicatorSetting: '2026-09-28T18:00:00.000Z',
  deadlineIndicatorConfirm: '2026-09-30T09:00:00.000Z',
  deadlineSelfEval: '2027-01-05T18:00:00.000Z',
  deadlineManagerScore: '2027-01-08T18:00:00.000Z',
  deadlineHrCalibration: '2027-01-11T18:00:00.000Z',
  deadlineApproval: '2027-01-13T18:00:00.000Z',
  deadlinePublish: '2027-01-14T18:00:00.000Z',
  status: 'draft',
  hrOwnerId: 'hr-1',
  reviewerId: 'hr-1',
  participantDeptIds: [],
  participantUserIds: [],
  explicitExemptDeptIds: [],
  explicitExemptUserIds: [],
  notificationMode: 'off',
  publishVisibleFields: {},
  gradeAMaxRatio: 0.2,
  gradeBMaxRatio: 0.4,
  gradeCMaxRatio: 0.3,
  gradeDMaxRatio: 0.1,
} satisfies AssessmentCycle;

const scrollableDepartmentTree: Department[] = [{
  id: 'company-root',
  name: '孚德',
  fullPath: '孚德',
  parentId: null,
  company: 'fuede',
  sortOrder: 1,
  isActive: true,
  directMemberCount: 1,
  children: Array.from({ length: 36 }, (_, index) => ({
    id: `department-${index + 1}`,
    name: `测试部门 ${String(index + 1).padStart(2, '0')}`,
    fullPath: `孚德 / 测试部门 ${String(index + 1).padStart(2, '0')}`,
    parentId: 'company-root',
    company: 'fuede' as const,
    sortOrder: index + 1,
    isActive: true,
    directMemberCount: index + 1,
    children: [],
  })),
}];

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
  await page.route('**/api/v1/departments**', (route) => {
    const requestUrl = new URL(route.request().url());
    options.departmentUrls?.push(requestUrl.toString());
    const activeTreeRequested = requestUrl.searchParams.get('isActive') === 'true'
      && requestUrl.searchParams.get('flat') !== 'true';
    const departments = activeTreeRequested
      ? options.departments ?? [{
          id: 'company-root',
          name: '孚德',
          fullPath: '孚德',
          isActive: true,
          directMemberCount: 1,
          children: [
            {
              id: 'sales',
              name: '销售部',
              fullPath: '孚德 / 销售部',
              isActive: true,
              directMemberCount: 10,
              children: [{
                id: 'sales-b2b',
                name: 'B2B销售组',
                fullPath: '孚德 / 销售部 / B2B销售组',
                isActive: true,
                directMemberCount: 8,
                children: [],
              }],
            },
            {
              id: 'product',
              name: '产品部',
              fullPath: '孚德 / 产品部',
              isActive: true,
              directMemberCount: 8,
              children: [],
            },
          ],
        }]
      : [
          {
            id: 'sales',
            name: '销售部',
            fullPath: '孚德 / 销售部',
            isActive: true,
          },
          {
            id: 'sales-b2b',
            name: 'B2B销售组',
            fullPath: '孚德 / 销售部 / B2B销售组',
            isActive: true,
          },
          {
            id: 'legacy-b2b',
            name: 'B2B销售组',
            fullPath: '历史组织 / 销售部 / B2B销售组',
            isActive: false,
          },
        ];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse(departments)),
    });
  });
  await page.route('**/api/v1/users**', (route) => {
    const requestUrl = new URL(route.request().url());
    const users = [
      {
        id: 'hr-1',
        name: '姚瑶',
        employeeNo: 'HR001',
        deptId: 'hr-dept',
        deptName: '人力资源部',
        sysRole: 'hr',
        status: 'active',
      },
      {
        id: 'employee-1',
        name: '陈晨',
        employeeNo: 'E001',
        deptId: 'sales',
        deptName: '销售部',
        sysRole: 'employee',
        status: 'active',
      },
      {
        id: 'employee-2',
        name: '周舟',
        employeeNo: 'E002',
        deptId: 'product',
        deptName: '产品部',
        sysRole: 'employee',
        status: 'active',
      },
      {
        id: 'employee-probation',
        name: '孙珊',
        employeeNo: 'P001',
        deptId: 'product',
        deptName: '产品部',
        sysRole: 'employee',
        status: 'probation',
      },
    ];
    const requestedStatus = requestUrl.searchParams.get('status');
    const requestedDepartmentId = requestUrl.searchParams.get('deptId');
    const departmentScope = requestedDepartmentId === 'sales'
      ? new Set(['sales', 'sales-b2b'])
      : requestedDepartmentId === 'product'
        ? new Set(['product'])
        : null;
    const statusItems = requestedStatus
      ? users.filter((user) => user.status === requestedStatus)
      : users.filter((user) => user.status !== 'resigned');
    const items = departmentScope
      ? statusItems.filter((user) => departmentScope.has(user.deptId))
      : statusItems;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: items.length,
        page: 1,
        pageSize: 50,
        items,
      })),
    });
  });
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
    if (route.request().url().endsWith('/cycles/schedule-preview')) {
      const body = route.request().postDataJSON() as {
        type: string;
        scoringFrequency?: 'monthly' | 'cycle';
        startDate: string;
        endDate: string;
      };
      const scoringFrequency = body.type === 'monthly'
        ? 'monthly'
        : body.type === 'custom' || body.type === 'probation'
          ? 'cycle'
          : body.scoringFrequency ?? 'monthly';
      const count = scoringFrequency === 'cycle'
        ? 1
        : ({ monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as Record<string, number>)[body.type] ?? 1;
      const start = new Date(`${body.startDate}T00:00:00+08:00`);
      const schedules = Array.from({ length: count }, (_, index) => {
        const periodStart = new Date(start);
        periodStart.setMonth(periodStart.getMonth() + index);
        const periodKey = scoringFrequency === 'cycle'
          ? 'cycle'
          : `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
        return {
          periodKey,
          periodType: scoringFrequency === 'cycle' ? 'cycle' : 'month',
          sequence: index + 1,
          periodStart: scoringFrequency === 'cycle' ? body.startDate : `${periodKey}-01`,
          periodEnd: scoringFrequency === 'cycle' ? body.endDate : `${periodKey}-28`,
          selfEvalOpenAt: `${periodKey === 'cycle' ? body.endDate : `${periodKey}-01`}T09:00:00+08:00`,
          selfEvalDueAt: `${periodKey === 'cycle' ? body.endDate : `${periodKey}-03`}T18:00:00+08:00`,
          managerDueAt: `${periodKey === 'cycle' ? body.endDate : `${periodKey}-06`}T18:00:00+08:00`,
          isException: false,
        };
      });
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          scoringFrequency,
          reviewFrequency: 'cycle',
          schedules,
          blockers: [],
          warnings: [],
        })),
      });
    }
    if (route.request().method() === 'PATCH' && route.request().url().endsWith('/notification-mode')) {
      const notificationMode = String(route.request().postDataJSON()?.notificationMode ?? 'off');
      options.notificationModeUpdates?.push(notificationMode);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ ...createdCycle, notificationMode })),
      });
    }
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      options.updateBodies?.push(body);
      const notificationMode = String(body?.notificationMode ?? 'off');
      options.notificationModeUpdates?.push(notificationMode);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ ...createdCycle, ...body, notificationMode })),
      });
    }
    if (route.request().method() === 'POST') {
      options.createBodies?.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse(createdCycle)),
      });
    }
    options.cycleUrls?.push(route.request().url());
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
  test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173' });

  test('replaces an empty pending table with a launch-oriented action', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');

    await expect(page.getByTestId('cycle-group-attention')).toHaveText('待发起');
    await expect(page.getByTestId('cycle-empty-state')).toContainText('暂无待发起周期');
    await expect(page.getByTestId('cycle-empty-create')).toBeVisible();
    await expect(page.locator('.app-pager')).toHaveCount(0);
  });

  test('lets all-company cycles exclude departments and people from the scope drawer', async ({ page }) => {
    const createBodies: unknown[] = [];
    await mockCycleLaunchPage(page, { cycles: [], createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    const dialog = page.getByRole('dialog', { name: '创建绩效周期' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('cycle-create-flow')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: '全公司' })).toBeChecked();
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('系统默认计划');
    await expect(page.getByTestId('cycle-create-summary')).toHaveCount(0);
    await expect(page.getByTestId('cycle-create-save-draft')).toHaveText('保存草稿');
    await expect(page.getByTestId('cycle-create-save-and-view')).toHaveText('下一步');
    await expect(dialog.getByRole('button', { name: '仅保存草稿' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '保存并检查' })).toHaveCount(0);
    await expect(page.getByTestId('cycle-create-impact-hint')).toContainText('不发送钉钉通知');

    await expect(page.getByTestId('cycle-scope-picker-open')).toContainText('设置排除范围');
    await page.getByTestId('cycle-scope-picker-open').click();
    const scopeDrawer = page.getByRole('dialog', { name: '选择考核对象' });
    await expect(scopeDrawer).toBeVisible();
    await expect(scopeDrawer.getByRole('tab', { name: '按部门' })).toHaveCount(0);
    await expect(scopeDrawer.getByRole('tab', { name: '按人员' })).toHaveCount(0);
    await expect(scopeDrawer.getByRole('tab', { name: '排除部门' })).toBeVisible();
    await expect(scopeDrawer.getByRole('tab', { name: '排除人员' })).toBeVisible();
    await expect(scopeDrawer).toContainText('正式人数以发起检查结果为准');
    await expect(scopeDrawer).not.toContainText('提交后的发起检查');

    const excludedDepartmentTree = scopeDrawer.getByTestId('cycle-scope-excluded-department-tree');
    const salesDepartment = excludedDepartmentTree
      .locator('.el-tree-node__content')
      .filter({ hasText: '销售部' })
      .locator('.el-checkbox');
    await salesDepartment.click();
    await scopeDrawer.getByRole('tab', { name: '排除人员' }).click();
    await scopeDrawer.getByTestId('cycle-scope-excluded-select').locator('.el-select').click();
    await page.locator('li.el-select-dropdown__item:visible').filter({ hasText: '孙珊 (P001)' }).last().click();
    await scopeDrawer.getByRole('button', { name: '确定' }).click();

    await expect(page.getByTestId('cycle-scope-summary')).toContainText('全公司');
    await expect(page.getByTestId('cycle-scope-summary')).toContainText('排除 1 个部门，包含 1 个下级组织（预计 18 人）');
    await expect(page.getByTestId('cycle-scope-summary')).toContainText('另排除 1 人');
    await page.getByTestId('cycle-create-save-draft').click();

    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      participantDeptIds: [],
      participantUserIds: [],
      explicitExemptDeptIds: expect.arrayContaining(['sales', 'sales-b2b']),
      explicitExemptUserIds: ['employee-probation'],
    });
  });

  test('shows the estimated employee count when a custom scope contains only a department', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await page.getByTestId('cycle-scope-custom').click();
    await page.getByTestId('cycle-scope-picker-open').click();
    const scopeDrawer = page.getByRole('dialog', { name: '选择考核对象' });
    const tree = scopeDrawer.getByTestId('cycle-scope-department-tree');
    await tree
      .locator('.el-tree-node__content')
      .filter({ hasText: '产品部' })
      .locator('.el-checkbox')
      .click();
    await scopeDrawer.getByRole('button', { name: '确定' }).click();

    await expect(page.getByTestId('cycle-scope-summary')).toContainText('已选 1 个部门（预计 8 人）');
    await expect(page.getByTestId('cycle-scope-summary')).toContainText('另选 0 人');
  });

  test('uses the available desktop drawer height for a long department tree and keeps one scroll area', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockCycleLaunchPage(page, { cycles: [], departments: scrollableDepartmentTree });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-scope-custom').click();
    await page.getByTestId('cycle-scope-picker-open').click();

    const drawer = page.getByRole('dialog', { name: '选择考核对象' });
    const body = drawer.locator('.el-drawer__body');
    const panel = drawer.getByTestId('cycle-scope-department-tree');
    const footer = drawer.locator('.el-drawer__footer');
    const bodyBox = await body.boundingBox();
    const panelBox = await panel.boundingBox();
    const footerBox = await footer.boundingBox();

    expect(bodyBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(panelBox!.height).toBeGreaterThan(bodyBox!.height * 0.55);
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
    await expect.poll(() => body.evaluate((element) => getComputedStyle(element).overflowY)).toBe('hidden');
    await expect.poll(() => panel.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollable: element.scrollHeight > element.clientHeight,
    }))).toEqual({ overflowY: 'auto', scrollable: true });

    await panel.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    const lastDepartmentBox = await panel.getByText('测试部门 36', { exact: true }).boundingBox();
    const scrolledPanelBox = await panel.boundingBox();
    expect(lastDepartmentBox).not.toBeNull();
    expect(lastDepartmentBox!.y).toBeGreaterThanOrEqual(scrolledPanelBox!.y);
    expect(lastDepartmentBox!.y + lastDepartmentBox!.height).toBeLessThanOrEqual(
      scrolledPanelBox!.y + scrolledPanelBox!.height,
    );
  });

  test('keeps the scope drawer footer visible and the department tree contained at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCycleLaunchPage(page, { cycles: [], departments: scrollableDepartmentTree });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-scope-custom').click();
    await page.getByTestId('cycle-scope-picker-open').click();

    const drawer = page.getByRole('dialog', { name: '选择考核对象' });
    const body = drawer.locator('.el-drawer__body');
    const panel = drawer.getByTestId('cycle-scope-department-tree');
    const footer = drawer.locator('.el-drawer__footer');
    await panel
      .locator('.el-tree-node__content')
      .filter({ hasText: '孚德' })
      .first()
      .locator('.el-checkbox')
      .click();
    await expect(footer).toContainText('已选 1 个部门，包含 36 个下级组织');
    const drawerBox = await drawer.boundingBox();
    const panelBox = await panel.boundingBox();
    const footerBox = await footer.boundingBox();

    expect(drawerBox).not.toBeNull();
    // Chromium can report a tiny fractional layout residue beyond the integer viewport width.
    expect(drawerBox!.width).toBeLessThanOrEqual(390 + 0.01);
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(844);
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
    await expect.poll(() => body.evaluate((element) => getComputedStyle(element).overflowY)).toBe('hidden');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('counts a checked parent separately from its automatically included descendants', async ({ page }) => {
    const createBodies: unknown[] = [];
    await mockCycleLaunchPage(page, { cycles: [], createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await page.getByTestId('cycle-scope-custom').click();
    await page.getByTestId('cycle-scope-picker-open').click();
    const scopeDrawer = page.getByRole('dialog', { name: '选择考核对象' });
    const tree = scopeDrawer.getByTestId('cycle-scope-department-tree');
    await tree
      .locator('.el-tree-node__content')
      .filter({ hasText: '销售部' })
      .locator('.el-checkbox')
      .click();
    await scopeDrawer.getByRole('button', { name: '确定' }).click();

    const summary = page.getByTestId('cycle-scope-summary');
    await expect(summary).toContainText('已选 1 个部门，包含 1 个下级组织（预计 18 人）');
    await expect(summary).not.toContainText('2 个部门');

    await page.getByTestId('cycle-create-save-draft').click();
    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      participantDeptIds: expect.arrayContaining(['sales', 'sales-b2b']),
    });
  });

  test('limits custom-scope exceptions to people and descendants inside the included departments', async ({ page }) => {
    const createBodies: unknown[] = [];
    const departmentUrls: string[] = [];
    await mockCycleLaunchPage(page, { cycles: [], createBodies, departmentUrls });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await expect.poll(() => departmentUrls.length).toBeGreaterThan(0);
    const requestUrl = new URL(departmentUrls[0]);
    expect(requestUrl.searchParams.get('isActive')).toBe('true');
    expect(requestUrl.searchParams.get('flat')).not.toBe('true');

    await page.getByTestId('cycle-scope-custom').click();
    await page.getByTestId('cycle-scope-picker-open').click();
    const scopeDrawer = page.getByRole('dialog', { name: '选择考核对象' });
    const tree = scopeDrawer.getByTestId('cycle-scope-department-tree');
    await expect(tree.getByText('孚德', { exact: true })).toBeVisible();
    await expect(tree.getByText('销售部', { exact: true })).toBeVisible();
    await expect(tree.getByText('B2B销售组', { exact: true })).toHaveCount(1);

    const salesDepartment = tree
      .locator('.el-tree-node__content')
      .filter({ hasText: '销售部' })
      .locator('.el-checkbox');
    await salesDepartment.click();

    await scopeDrawer.getByRole('tab', { name: '例外部门' }).click();
    const exceptionTree = scopeDrawer.getByTestId('cycle-scope-excluded-department-tree');
    await expect(exceptionTree.getByText('B2B销售组', { exact: true })).toBeVisible();
    await expect(exceptionTree.getByText('销售部', { exact: true })).toHaveCount(0);
    await expect(exceptionTree.getByText('产品部', { exact: true })).toHaveCount(0);
    await exceptionTree
      .locator('.el-tree-node__content')
      .filter({ hasText: 'B2B销售组' })
      .locator('.el-checkbox')
      .click();

    await scopeDrawer.getByRole('tab', { name: '例外人员' }).click();
    const excludedSelect = scopeDrawer.getByTestId('cycle-scope-excluded-select');
    await excludedSelect.locator('.el-select').click();
    await expect(page.locator('li.el-select-dropdown__item:visible').filter({ hasText: '陈晨 (E001)' })).toBeVisible();
    await expect(page.locator('li.el-select-dropdown__item:visible').filter({ hasText: '周舟 (E002)' })).toHaveCount(0);
    await expect(page.locator('li.el-select-dropdown__item:visible').filter({ hasText: '孙珊 (P001)' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await scopeDrawer.getByRole('button', { name: '确定' }).click();

    const summary = page.getByTestId('cycle-scope-summary');
    await expect(summary).toContainText('已选 1 个部门，包含 1 个下级组织');
    await expect(summary).toContainText('排除例外：1 个下级组织');
    await expect(summary).toContainText('预计参评 10 人');
    await page.getByTestId('cycle-create-save-draft').click();

    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      participantDeptIds: expect.arrayContaining(['sales', 'sales-b2b']),
      participantUserIds: [],
      explicitExemptDeptIds: ['sales-b2b'],
      explicitExemptUserIds: [],
    });
  });

  test('clears stale people exceptions when the included departments change', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-scope-custom').click();
    await page.getByTestId('cycle-scope-picker-open').click();

    const scopeDrawer = page.getByRole('dialog', { name: '选择考核对象' });
    const tree = scopeDrawer.getByTestId('cycle-scope-department-tree');
    const salesDepartment = tree
      .locator('.el-tree-node__content')
      .filter({ hasText: '销售部' })
      .locator('.el-checkbox');
    const productDepartment = tree
      .locator('.el-tree-node__content')
      .filter({ hasText: '产品部' })
      .locator('.el-checkbox');
    await salesDepartment.click();
    await scopeDrawer.getByRole('tab', { name: '例外人员' }).click();
    await scopeDrawer.getByTestId('cycle-scope-excluded-select').locator('.el-select').click();
    await page.locator('li.el-select-dropdown__item:visible').filter({ hasText: '陈晨 (E001)' }).click();
    await page.keyboard.press('Escape');
    await expect(scopeDrawer.locator('.scope-drawer-footer')).toContainText('排除例外：1 人');

    await scopeDrawer.getByRole('tab', { name: '按部门' }).click();
    await salesDepartment.click();
    await productDepartment.click();

    await expect(scopeDrawer.locator('.scope-drawer-footer')).not.toContainText('排除例外');
    await scopeDrawer.getByRole('tab', { name: '例外人员' }).click();
    await scopeDrawer.getByTestId('cycle-scope-excluded-select').locator('.el-select').click();
    await expect(page.locator('li.el-select-dropdown__item:visible').filter({ hasText: '陈晨 (E001)' })).toHaveCount(0);
    await expect(page.locator('li.el-select-dropdown__item:visible').filter({ hasText: '周舟 (E002)' })).toBeVisible();
  });

  test('does not carry custom exceptions into an all-company scope', async ({ page }) => {
    const createBodies: unknown[] = [];
    await mockCycleLaunchPage(page, { cycles: [], createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-scope-custom').click();
    await page.getByTestId('cycle-scope-picker-open').click();

    const scopeDrawer = page.getByRole('dialog', { name: '选择考核对象' });
    await scopeDrawer.getByTestId('cycle-scope-department-tree')
      .locator('.el-tree-node__content')
      .filter({ hasText: '销售部' })
      .locator('.el-checkbox')
      .click();
    await scopeDrawer.getByRole('tab', { name: '例外部门' }).click();
    await scopeDrawer.getByTestId('cycle-scope-excluded-department-tree')
      .locator('.el-tree-node__content')
      .filter({ hasText: 'B2B销售组' })
      .locator('.el-checkbox')
      .click();
    await scopeDrawer.getByRole('button', { name: '确定' }).click();
    await expect(page.getByTestId('cycle-scope-summary')).toContainText('排除例外：1 个下级组织');

    await page.getByTestId('cycle-scope-all').click();
    await expect(page.getByTestId('cycle-scope-summary')).toHaveText('全公司');
    await page.getByTestId('cycle-create-save-draft').click();

    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      participantDeptIds: [],
      participantUserIds: [],
      explicitExemptDeptIds: [],
      explicitExemptUserIds: [],
    });
  });

  test('opens a user-only draft as a custom scope instead of all-company', async ({ page }) => {
    const userOnlyCycle: AssessmentCycle = {
      ...createdCycle,
      participantUserIds: ['employee-1'],
      explicitExemptUserIds: ['employee-2'],
    };
    await mockCycleLaunchPage(page, { cycles: [userOnlyCycle] });
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-edit-cycle-created').click();
    const dialog = page.getByRole('dialog', { name: '编辑绩效周期' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: '自定义范围' })).toBeChecked();
    await expect(dialog.getByTestId('cycle-scope-summary')).toContainText('已选 0 个部门（预计 0 人）');
    await expect(dialog.getByTestId('cycle-scope-summary')).toContainText('另选 1 人');
    await expect(dialog.getByTestId('cycle-scope-summary')).toContainText('排除例外：1 人');
  });

  test('restores valid department exceptions when reopening a saved custom draft', async ({ page }) => {
    const excludedDepartmentCycle: AssessmentCycle = {
      ...createdCycle,
      participantDeptIds: ['sales', 'sales-b2b'],
      explicitExemptDeptIds: ['sales-b2b'],
    };
    await mockCycleLaunchPage(page, { cycles: [excludedDepartmentCycle] });
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-edit-cycle-created').click();
    const dialog = page.getByRole('dialog', { name: '编辑绩效周期' });
    await dialog.getByTestId('cycle-scope-picker-open').click();
    const scopeDrawer = page.getByRole('dialog', { name: '选择考核对象' });
    await scopeDrawer.getByRole('tab', { name: '例外部门' }).click();
    const excludedDepartmentTree = scopeDrawer.getByTestId('cycle-scope-excluded-department-tree');
    await expect(excludedDepartmentTree.getByText('销售部', { exact: true })).toHaveCount(0);
    await expect(excludedDepartmentTree
      .locator('.el-tree-node__content')
      .filter({ hasText: 'B2B销售组' })
      .locator('.el-checkbox')).toHaveClass(/is-checked/);
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

  test('lets HR change the notification mode while editing an existing draft cycle', async ({ page }) => {
    const notificationModeUpdates: string[] = [];
    await mockCycleLaunchPage(page, { cycles: [createdCycle], notificationModeUpdates });
    await page.goto('/cycles?group=attention');

    await page.getByTestId('cycle-edit-cycle-created').click();
    const dialog = page.getByRole('dialog', { name: '编辑绩效周期' });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('cycle-notification-launch-only').click();
    await dialog.getByTestId('cycle-create-save-and-view').click();

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
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('2026-12-18 09:00');
  });

  test('links half-year type to the next complete natural half-year', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00+08:00'));
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    const dialog = page.getByRole('dialog', { name: '创建绩效周期' });
    await dialog.locator('.el-select').first().click();
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '半年' }).click();

    await expect(dialog.getByPlaceholder('系统自动生成，可直接修改')).toHaveValue('2027 上半年绩效考核');
    await expect(dialog.getByPlaceholder('开始日期')).toHaveValue('2027-01-01');
    await expect(dialog.getByPlaceholder('结束日期')).toHaveValue('2027-06-30');
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('2026-12-18 09:00');
  });

  test('shows saved half-year cycles and sends the half-year list filter', async ({ page }) => {
    const cycleUrls: string[] = [];
    const semiannualCycle = {
      ...createdCycle,
      id: 'cycle-semiannual',
      name: '2027年03月—08月半年绩效考核',
      type: 'semiannual',
      startDate: '2027-03-01',
      endDate: '2027-08-31',
    } satisfies AssessmentCycle;
    await mockCycleLaunchPage(page, { cycles: [semiannualCycle], cycleUrls });
    await page.goto('/cycles?group=attention');

    const cycleRow = page.locator('.cycle-cell').filter({ hasText: '2027年03月—08月半年绩效考核' });
    await expect(cycleRow).toBeVisible();
    await expect(cycleRow).toContainText('半年');

    await page.locator('.filter-row .el-select').nth(1).click();
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '半年' }).click();
    await expect.poll(() => cycleUrls.some((url) => new URL(url).searchParams.get('type') === 'semiannual')).toBe(true);
  });

  test('edits and saves a cross-year half-year after regenerating its schedule', async ({ page }) => {
    const updateBodies: unknown[] = [];
    const semiannualCycle = {
      ...createdCycle,
      id: 'cycle-semiannual-cross-year',
      name: '2027年11月—2028年04月半年绩效考核',
      type: 'semiannual',
      startDate: '2027-11-01',
      endDate: '2028-04-30',
    } satisfies AssessmentCycle;
    await mockCycleLaunchPage(page, { cycles: [semiannualCycle], updateBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-edit-cycle-semiannual-cross-year').click();

    const dialog = page.getByRole('dialog', { name: '编辑绩效周期' });
    await expect(dialog.getByPlaceholder('系统自动生成，可直接修改')).toHaveValue('2027年11月—2028年04月半年绩效考核');
    await expect(dialog.getByPlaceholder('开始日期')).toHaveValue('2027-11-01');
    await expect(dialog.getByPlaceholder('结束日期')).toHaveValue('2028-04-30');
    await expect(dialog.getByTestId('cycle-semiannual-warning')).toHaveCount(0);

    const startDateInput = dialog.getByPlaceholder('开始日期');
    await startDateInput.fill('2027-12-01');
    await startDateInput.press('Enter');

    let confirmation = page.getByRole('dialog', { name: '是否同步调整时间节点？' });
    await expect(confirmation).toContainText('2027-11-01—2028-04-30');
    await expect(confirmation).toContainText('2027-12-01—2028-05-31');
    await confirmation.getByRole('button', { name: '同步重新生成（推荐）' }).click();
    await expect(confirmation).toBeHidden();

    const endDateInput = dialog.getByPlaceholder('结束日期');
    await endDateInput.fill('2028-05-31');
    await endDateInput.press('Enter');

    await expect(dialog.getByPlaceholder('开始日期')).toHaveValue('2027-12-01');
    await expect(dialog.getByPlaceholder('结束日期')).toHaveValue('2028-05-31');
    await dialog.getByTestId('cycle-create-save-and-view').click();

    await expect.poll(() => updateBodies).toHaveLength(1);
    expect(updateBodies[0]).toMatchObject({
      type: 'semiannual',
      startDate: '2027-12-01',
      endDate: '2028-05-31',
    });
    const updatedBody = updateBodies[0] as Record<string, unknown>;
    expect(updatedBody.goalSettingOpenAt).toEqual(expect.any(String));
    expect(updatedBody.deadlinePublish).toEqual(expect.any(String));
    expect(updatedBody.goalSettingOpenAt).not.toBe(createdCycle.goalSettingOpenAt);
    expect(updatedBody.deadlinePublish).not.toBe(createdCycle.deadlinePublish);
  });

  test('auto-completes a rolling half-year after HR changes its start date', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00+08:00'));
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    const dialog = page.getByRole('dialog', { name: '创建绩效周期' });
    await dialog.locator('.el-select').first().click();
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '半年' }).click();
    await dialog.getByPlaceholder('开始日期').click();

    const picker = page.locator('.el-picker-panel:visible');
    await picker.locator('button.arrow-right').click();
    await picker.locator('button.arrow-right').click();
    await picker.locator('td.available:not(.prev-month):not(.next-month)').filter({ hasText: /^1$/ }).click();

    await expect(dialog.getByPlaceholder('开始日期')).toHaveValue('2027-03-01');
    await expect(dialog.getByPlaceholder('结束日期')).toHaveValue('2027-08-31');
    await expect(dialog.getByPlaceholder('系统自动生成，可直接修改')).toHaveValue('2027年03月—08月半年绩效考核');
    await expect(page.getByText('已按开始日期自动补齐连续六个自然月')).toBeVisible();
  });

  test('warns without blocking when HR fine-tunes a rolling half-year end date', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00+08:00'));
    const createBodies: unknown[] = [];
    await mockCycleLaunchPage(page, { cycles: [], createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    const dialog = page.getByRole('dialog', { name: '创建绩效周期' });
    await dialog.locator('.el-select').first().click();
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '半年' }).click();
    await dialog.getByPlaceholder('开始日期').click();
    let picker = page.locator('.el-picker-panel:visible');
    await picker.locator('button.arrow-right').click();
    await picker.locator('button.arrow-right').click();
    await picker.locator('td.available:not(.prev-month):not(.next-month)').filter({ hasText: /^1$/ }).click();

    await expect(page.locator('.el-picker-panel:visible')).toHaveCount(0);
    await dialog.getByPlaceholder('结束日期').click();
    picker = page.locator('.el-picker-panel:visible');
    await picker.locator('button.arrow-right').click();
    await picker.locator('td.available:not(.prev-month):not(.next-month)').filter({ hasText: /^1$/ }).click();

    await expect(dialog.getByTestId('cycle-semiannual-warning')).toContainText(
      '当前期间不是完整的连续六个月，仍可保存，请确认符合本次考核安排',
    );
    await expect(dialog.getByPlaceholder('系统自动生成，可直接修改')).toHaveValue('2027年03月—09月半年绩效考核');
    await dialog.getByTestId('cycle-create-save-draft').click();

    await expect.poll(() => createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      type: 'semiannual',
      startDate: '2027-03-01',
      endDate: '2027-09-01',
    });
  });

  test('recalculates the default plan when HR changes the cycle type', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    const dialog = page.getByRole('dialog', { name: '创建绩效周期' });
    await dialog.locator('.el-select').first().click();
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '月度' }).click();

    await expect(dialog.getByPlaceholder('系统自动生成，可直接修改')).toHaveValue('2026年09月绩效考核');
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('2026-08-18 09:00');
  });

  test('uses official workdays and presents the default plan in business order', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();

    await expect(page.getByTestId('cycle-plan-summary')).toContainText('系统默认计划');
    await expect(page.getByTestId('cycle-plan-summary')).toContainText('按中国法定工作日（含调休）');

    await page.getByTestId('cycle-create-advanced').click();
    await page.getByTestId('cycle-advanced-schedule').click();

    await expect(page.getByTestId('cycle-schedule-calendar-warning')).toContainText(
      '2027 年法定节假日日历尚未维护，相关节点暂按周一至周五排期',
    );
    await expect(page.getByTestId('cycle-schedule-period')).toHaveText('考核执行期 2026-10-01—2026-12-31');

    const nodes = page.getByTestId('cycle-schedule-node');
    await expect(nodes).toHaveCount(9);
    await expect(nodes.nth(0)).toContainText('01');
    await expect(nodes.nth(0)).toContainText('目标制定开放');
    await expect(nodes.nth(3)).toContainText('04');
    await expect(nodes.nth(3)).toContainText('员工自评开放');
    await expect(nodes.nth(8)).toContainText('09');
    await expect(nodes.nth(8)).toContainText('结果公示截止');

    const expectedTimes = [
      '2026-09-17 09:00:00',
      '2026-09-28 18:00:00',
      '2026-09-30 18:00:00',
      '2027-01-04 09:00:00',
      '2027-01-06 18:00:00',
      '2027-01-11 18:00:00',
      '2027-01-13 18:00:00',
      '2027-01-15 18:00:00',
      '2027-01-18 18:00:00',
    ];
    await expect(nodes.locator('.el-date-editor input')).toHaveCount(expectedTimes.length);
    for (let index = 0; index < expectedTimes.length; index += 1) {
      await expect(nodes.nth(index).locator('.el-date-editor input')).toHaveValue(expectedTimes[index]);
    }
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

    await expect(page.getByTestId('cycle-plan-summary')).toContainText('已调整计划');
  });

  test('shows inline reminders without blocking a schedule that crosses the performance period', async ({ page }) => {
    const createBodies: unknown[] = [];
    await mockCycleLaunchPage(page, { cycles: [], createBodies });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-create-advanced').click();
    await page.getByTestId('cycle-advanced-schedule').click();

    const nodes = page.getByTestId('cycle-schedule-node');
    const preparationTimes = [
      '2026-10-02 09:00:00',
      '2026-10-03 18:00:00',
      '2026-10-04 18:00:00',
    ];
    for (let index = 0; index < preparationTimes.length; index += 1) {
      const input = nodes.nth(index).locator('.el-date-editor input');
      await input.fill(preparationTimes[index]);
      await input.press('Enter');
    }

    await expect(nodes.nth(0).getByTestId('cycle-schedule-boundary-warning')).toHaveText(
      '该时间已进入考核期间，仍可保存，请确认符合实际安排。',
    );
    await page.getByTestId('cycle-create-save-draft').click();

    await expect.poll(() => createBodies).toHaveLength(1);
    await expect(page.locator('.el-message')).not.toContainText('应在考核周期开始前完成');
  });

  test('preserves saved cycle dates instead of silently recalculating them on edit', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [createdCycle] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-edit-cycle-created').click();

    const dialog = page.getByRole('dialog', { name: '编辑绩效周期' });
    await expect(dialog.getByTestId('cycle-plan-summary')).toContainText('已调整计划');
    const nodes = dialog.getByTestId('cycle-schedule-node');
    await expect(nodes.nth(0).locator('.el-date-editor input')).toHaveValue('2026-09-21 17:00:00');
    await expect(nodes.nth(3).locator('.el-date-editor input')).toHaveValue('2027-01-01 17:00:00');
  });

  test('asks before regenerating saved nodes when an edited cycle period changes', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [createdCycle] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-edit-cycle-created').click();

    const dialog = page.getByRole('dialog', { name: '编辑绩效周期' });
    const periodInputs = dialog.locator('.el-date-editor--daterange input');
    await periodInputs.nth(0).click();
    const picker = page.locator('.el-picker-panel:visible');
    await picker.locator('.el-date-range-picker__content.is-left td.available:not(.prev-month):not(.next-month)')
      .filter({ hasText: /^19$/ })
      .click();
    await picker.locator('.el-date-range-picker__content.is-right td.available:not(.prev-month):not(.next-month)')
      .filter({ hasText: /^30$/ })
      .click();

    const confirmation = page.getByRole('dialog', { name: '是否同步调整时间节点？' });
    await expect(confirmation).toContainText('2026-10-01—2026-12-31');
    await expect(confirmation).toContainText('2026-10-19—2026-11-30');
    await expect(confirmation).toContainText('中国法定工作日');
    await confirmation.getByRole('button', { name: '同步重新生成（推荐）' }).click();

    const nodes = dialog.getByTestId('cycle-schedule-node');
    await expect(nodes.nth(0).locator('.el-date-editor input')).toHaveValue('2026-09-29 09:00:00');
    await expect(dialog.getByTestId('cycle-plan-summary')).toContainText('系统默认计划');
  });

  test('keeps saved nodes when HR chooses not to regenerate after a period change', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [createdCycle] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-edit-cycle-created').click();

    const dialog = page.getByRole('dialog', { name: '编辑绩效周期' });
    const periodInputs = dialog.locator('.el-date-editor--daterange input');
    await periodInputs.nth(0).click();
    const picker = page.locator('.el-picker-panel:visible');
    await picker.locator('.el-date-range-picker__content.is-left td.available:not(.prev-month):not(.next-month)')
      .filter({ hasText: /^19$/ })
      .click();
    await picker.locator('.el-date-range-picker__content.is-right td.available:not(.prev-month):not(.next-month)')
      .filter({ hasText: /^30$/ })
      .click();

    const confirmation = page.getByRole('dialog', { name: '是否同步调整时间节点？' });
    await confirmation.getByRole('button', { name: '保留当前时间节点' }).click();

    const nodes = dialog.getByTestId('cycle-schedule-node');
    await expect(nodes.nth(0).locator('.el-date-editor input')).toHaveValue('2026-09-21 17:00:00');
    await expect(dialog.getByTestId('cycle-plan-summary')).toContainText('已调整计划');
  });

  test('keeps advanced groups collapsed with useful summaries', async ({ page }) => {
    await mockCycleLaunchPage(page, { cycles: [] });
    await page.goto('/cycles?group=attention');
    await page.getByTestId('cycle-create').click();
    await page.getByTestId('cycle-create-advanced').click();

    await expect(page.getByTestId('cycle-advanced-schedule')).toContainText('系统默认计划');
    await expect(page.getByTestId('cycle-advanced-grades')).toContainText('A 20%');
    await expect(page.getByTestId('cycle-advanced-publication')).toContainText('4 项可见');
    await expect(page.getByText('目标制定开放', { exact: true })).not.toBeVisible();
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

    await expect(page.getByText('目标制定开放', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cycle-create-save-and-view')).toHaveText('下一步');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const footer = await page.getByTestId('cycle-create-impact-hint').boundingBox();
    expect(footer?.y).toBeGreaterThanOrEqual(0);
    expect((footer?.y ?? 0) + (footer?.height ?? 0)).toBeLessThanOrEqual(844);
  });
});

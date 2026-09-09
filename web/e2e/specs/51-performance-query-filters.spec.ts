import { expect, test, type Page } from '@playwright/test';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });
const cycles = [
  { id: 'cycle-old', name: '历史周期', type: 'quarterly', status: 'closed', startDate: '2026-01-01', endDate: '2026-03-31', createdAt: '2026-01-02T08:00:00.000Z', publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1 },
  { id: 'cycle-new', name: '最新创建周期', type: 'quarterly', status: 'approval', startDate: '2026-04-01', endDate: '2026-06-30', createdAt: '2026-09-09T08:00:00.000Z', publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1 },
];
const departments = [
  { id: 'dept-hr', name: '人事部', fullPath: '孚德 / 人事部', isActive: true, sortOrder: 1, children: [] },
  { id: 'dept-sales', name: '销售部', fullPath: '孚德 / 销售部', isActive: true, sortOrder: 2, children: [] },
];

type PageCase = { path: string; request: RegExp };
const pageCases: PageCase[] = [
  { path: '/department-review', request: /\/tasks\/department-review/ },
  { path: '/calibration', request: /\/cycles\/cycle-new\/calibration/ },
  { path: '/approval', request: /\/cycles\/cycle-new\/approval(?:\?|$)/ },
  { path: '/publish', request: /\/cycles\/cycle-new\/publication-records/ },
  { path: '/appeals', request: /\/appeals(?:\?|$)/ },
  { path: '/interviews', request: /\/interviews(?:\?|$)/ },
  { path: '/improvement-plans', request: /\/improvement-plans(?:\?|$)/ },
];

async function mockPerformancePages(page: Page, requests: string[]) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'performance-filter-test');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    requests.push(route.request().url());
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405, json: apiResponse(null) });
    if (path.endsWith('/auth/me')) return route.fulfill({ json: apiResponse({
      id: 'admin', name: '系统管理员', sysRole: 'system_admin', status: 'active', canViewAll: true,
      businessCapabilities: {
        canReviewDepartment: true, canViewDepartmentReview: true, canOperateDepartmentReview: true,
        canViewPerformanceCalibration: true, canOperatePerformanceCalibration: true,
        canViewPerformanceApproval: true, canOperatePerformanceApproval: true,
        canHandleInterviews: true, canManageImprovementPlans: true,
      },
    }) });
    if (path.endsWith('/notifications/unread-count')) return route.fulfill({ json: apiResponse(0) });
    if (path.endsWith('/departments')) return route.fulfill({ json: apiResponse(departments) });
    if (path.endsWith('/calibration/cycles')) return route.fulfill({ json: apiResponse(cycles) });
    if (path.endsWith('/cycles/mine')) return route.fulfill({ json: apiResponse(cycles) });
    if (path.endsWith('/cycles')) return route.fulfill({ json: apiResponse({ items: cycles, total: cycles.length, page: 1, pageSize: 100 }) });

    if (path.endsWith('/tasks/department-review')) return route.fulfill({ json: apiResponse({ items: [], total: 0, pendingTotal: 0, page: 1, pageSize: 10 }) });
    if (path.endsWith('/calibration')) return route.fulfill({ json: apiResponse({ items: [], gradeDistribution: {}, totalActive: 0, progress: { finalGrading: 0, deptReview: 0, pending: 0, inApproval: 0, done: 0 } }) });
    if (path.endsWith('/approval/overview')) return route.fulfill({ json: apiResponse({ ownPending: 0, ownTotal: 0, cyclePending: 0, gradeDistribution: {}, rejects: [] }) });
    if (path.endsWith('/approval')) return route.fulfill({ json: apiResponse([]) });
    if (path.endsWith('/publication-records')) return route.fulfill({ json: apiResponse({ items: [], total: 0, page: 1, pageSize: 10 }) });
    if (path.endsWith('/appeals') || path.endsWith('/interviews') || path.endsWith('/improvement-plans')) {
      return route.fulfill({ json: apiResponse({ items: [], total: 0, page: 1, pageSize: 10 }) });
    }
    return route.fulfill({ json: apiResponse({}) });
  });
}

for (const pageCase of pageCases) {
  test(`${pageCase.path} uses the shared cycle, department and employee filters`, async ({ page }) => {
    const requests: string[] = [];
    await mockPerformancePages(page, requests);
    await page.goto(pageCase.path);

    const cycleFilter = page.getByTestId('performance-cycle-filter');
    const departmentFilter = page.getByTestId('performance-department-filter');
    const employeeFilter = page.getByTestId('performance-employee-filter');
    const filterRegion = page.getByRole('region', { name: '查询条件' });
    await expect(cycleFilter).toContainText('最新创建周期');
    await expect(departmentFilter).toBeVisible();
    await expect(employeeFilter).toBeVisible();
    await expect(filterRegion.locator('label')).toHaveCount(0);
    await expect(filterRegion.getByRole('combobox', { name: '绩效周期计划' })).toBeVisible();
    await expect(filterRegion.getByRole('combobox', { name: '部门' })).toBeVisible();
    await expect(filterRegion.getByRole('textbox', { name: '员工姓名或工号' })).toBeVisible();

    const positions = await Promise.all([cycleFilter, departmentFilter, employeeFilter].map(async locator => (await locator.boundingBox())!.x));
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);

    await departmentFilter.click();
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '人事部' }).click();
    await employeeFilter.fill('HR001');
    await page.getByRole('button', { name: '查询', exact: true }).click();

    await expect.poll(() => requests.filter(value => pageCase.request.test(new URL(value).pathname)).at(-1)).toBeTruthy();
    const matched = requests.filter(value => pageCase.request.test(new URL(value).pathname)).at(-1)!;
    const url = new URL(matched);
    expect(url.pathname.includes('cycle-new') || url.searchParams.get('cycleId') === 'cycle-new').toBe(true);
    expect(url.searchParams.get('deptId')).toBe('dept-hr');
    expect(url.searchParams.get('keyword')).toBe('HR001');
  });
}

test('HR interview and improvement pages load the full visible cycle catalogue', async ({ page }) => {
  const requests: string[] = [];
  await mockPerformancePages(page, requests);

  await page.goto('/interviews');
  await expect(page.getByTestId('performance-cycle-filter')).toContainText('最新创建周期');
  expect(requests.some(value => new URL(value).pathname.endsWith('/cycles'))).toBe(true);
  expect(requests.some(value => new URL(value).pathname.endsWith('/cycles/mine'))).toBe(false);

  requests.length = 0;
  await page.goto('/improvement-plans');
  await expect(page.getByTestId('performance-cycle-filter')).toContainText('最新创建周期');
  expect(requests.some(value => new URL(value).pathname.endsWith('/cycles'))).toBe(true);
  expect(requests.some(value => new URL(value).pathname.endsWith('/cycles/mine'))).toBe(false);
});

test('shared performance filters stack without horizontal overflow at 390px', async ({ page }) => {
  const requests: string[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPerformancePages(page, requests);
  await page.goto('/interviews');

  await expect(page.getByTestId('performance-cycle-filter')).toBeVisible();
  await expect(page.getByTestId('performance-department-filter')).toBeVisible();
  await expect(page.getByTestId('performance-employee-filter')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

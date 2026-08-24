import { expect, test, type Page } from '@playwright/test';

function apiResponse<T>(data: T) {
  return { code: 0, message: 'ok', data };
}

const resultCycle = {
  id: 'result-cycle',
  name: '2026年第二季度',
  status: 'published',
  startDate: '2026-04-01',
  endDate: '2026-06-30',
};

const emptyCapabilities = {
  canManageTeam: false,
  canReviewDepartment: false,
  canViewPerformanceApproval: false,
  canOperatePerformanceApproval: false,
  canHandleHrCycle: false,
  identities: [],
};

async function mockIdentity(
  page: Page,
  role: 'employee' | 'hr' | 'manager',
  businessCapabilities?: typeof emptyCapabilities,
) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'business-clarity-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: `${role}-1`,
      name: role === 'hr' ? 'HR用户' : role === 'manager' ? '周主管' : '动态业务负责人',
      deptId: 'dept-1',
      deptName: '研发部',
      sysRole: role,
      isAssessorOnly: false,
      canViewAll: role === 'hr',
      ...(businessCapabilities ? { businessCapabilities } : {}),
    })),
  }));
}

function reportItem(index: number, scored = false) {
  return {
    taskId: `task-${index}`,
    employeeName: `员工${index}`,
    employeeNo: `E${String(index).padStart(3, '0')}`,
    deptName: '研发部',
    position: '工程师',
    totalScore: scored ? 90 : null,
    grade: scored ? 'A' : null,
    managerName: '周主管',
  };
}

const reportSummary = {
  stats: {
    total: 12,
    resulted: 1,
    pending: 11,
    qualified: 1,
    qualifiedRate: 1,
    grades: {
      A: { count: 1, ratio: 1 },
      B: { count: 0, ratio: 0 },
      C: { count: 0, ratio: 0 },
      D: { count: 0, ratio: 0 },
    },
  },
  items: Array.from({ length: 12 }, (_, index) => reportItem(index + 1, index === 0)),
};

async function mockReportShell(page: Page) {
  await page.route('**/api/v1/cycles**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 50, items: [resultCycle] })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{ id: 'dept-1', name: '研发部', children: [] }])),
  }));
  await page.route('**/api/v1/reports/cycle/result-cycle/summary**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(reportSummary)),
  }));
}

test.describe('dashboard and reports business clarity', () => {
  test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173' });

  test('report separates pending results and computes department average from scored people only', async ({ page }) => {
    await mockIdentity(page, 'hr');
    await mockReportShell(page);

    await page.goto('/reports');

    await expect(page.getByTestId('report-stats-total')).toContainText('12');
    await expect(page.getByTestId('report-stats-resulted')).toContainText('1');
    await expect(page.getByTestId('report-stats-pending')).toContainText('11');
    await expect(page.getByTestId('report-stats-qualified-rate')).toContainText('100.0%');
    await expect(page.getByTestId('report-department-table').getByRole('row').filter({ hasText: '研发部' })).toContainText('90.00');
    await expect(page.getByTestId('report-export')).toHaveText('导出本周期全量');
    await expect(page.getByRole('tab', { name: '结果概览' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '重点关注' })).toBeVisible();
  });

  test('HR dashboard shows a five-person result preview instead of the full roster', async ({ page }) => {
    await mockIdentity(page, 'hr');
    await mockReportShell(page);

    await page.goto('/dashboard');

    await expect(page.getByTestId('dashboard-quick-actions')).toContainText('周期与计划');
    await expect(page.getByTestId('dashboard-quick-actions')).toContainText('绩效校准');
    await expect(page.getByTestId('dashboard-quick-actions')).toContainText('结果公示');
    await expect(page.getByTestId('dashboard-quick-actions')).toContainText('申诉管理');
    await expect(page.getByTestId('dashboard-result-summary')).toContainText('应参评12人');
    await expect(page.getByTestId('dashboard-result-summary')).toContainText('已出结果1人');
    await expect(page.getByTestId('dashboard-result-summary')).toContainText('待出结果11人');
    await expect(page.getByTestId('dashboard-result-preview-row')).toHaveCount(5);
    await expect(page.getByRole('button', { name: '查看完整报表' })).toBeVisible();
  });

  test('manager zero-pending cards offer a neutral list entry instead of a processing action', async ({ page }) => {
    await mockIdentity(page, 'manager');
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: 0,
        page: 1,
        pageSize: 1,
        items: [],
        counts: { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 },
        facets: { departments: [], employees: [] },
      })),
    }));
    await page.route('**/api/v1/cycles**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 50, items: [] })),
    }));

    await page.goto('/dashboard');

    await expect(page.getByTestId('manager-goal-review-open')).toHaveText('查看全部');
    await expect(page.getByTestId('manager-evaluation-open')).toHaveText('查看全部');
  });

  test('dynamic business identities drive dashboard team and approval entries without changing the employee role', async ({ page }) => {
    await mockIdentity(page, 'employee', {
      ...emptyCapabilities,
      canManageTeam: true,
      canViewPerformanceApproval: true,
      canOperatePerformanceApproval: true,
      identities: [
        { type: 'performance_manager', label: '绩效直属上级', count: 1 },
        { type: 'performance_approver', label: '最终业务审批人', count: 1 },
      ],
    });
    await page.route('**/api/v1/tasks/mine**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
    }));
    await page.route('**/api/v1/tasks/team**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        total: 0,
        page: 1,
        pageSize: 1,
        items: [],
        counts: { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 },
        facets: { departments: [], employees: [] },
      })),
    }));
    await page.route('**/api/v1/cycles**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 50, items: [] })),
    }));

    await page.goto('/dashboard');

    await page.getByRole('button', { name: /动态业务负责人/ }).click();
    await expect(page.getByRole('menu')).toContainText('绩效直属上级 · 1 项');
    await page.getByRole('button', { name: /动态业务负责人/ }).click();
    await expect(page.getByTestId('manager-goal-review-open')).toBeVisible();
    await expect(page.getByTestId('manager-evaluation-open')).toBeVisible();
    await expect(page.getByTestId('dashboard-quick-actions')).toContainText('结果审批');
    await expect(page.getByTestId('dashboard-result-summary')).toHaveCount(0);
  });

  test('report keeps the business tabs usable on a phone-sized viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockIdentity(page, 'hr');
    await mockReportShell(page);

    await page.goto('/reports');

    await expect(page.getByRole('tab', { name: '结果概览' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '重点关注' })).toBeVisible();
    await expect(page.getByTestId('report-stats-pending')).toContainText('11');
    const pageOverflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(pageOverflows).toBe(false);
  });
});

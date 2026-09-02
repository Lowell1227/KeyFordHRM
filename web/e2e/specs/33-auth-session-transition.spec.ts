import { expect, test, type Page } from '@playwright/test';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

async function mockManagerTaskWorkspace(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'logout-regression-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
    localStorage.setItem('passwordChangeRequired', 'false');
  });

  let unauthorizedTaskRequests = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const authenticated = request.headers().authorization === 'Bearer logout-regression-token';

    if (path === '/api/v1/auth/me') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          id: 'manager-logout',
          name: '退出验收主管',
          employeeNo: 'MGR-LOGOUT',
          deptId: 'dept-1',
          deptName: '研发部',
          sysRole: 'manager',
          isAssessorOnly: false,
          canViewAll: false,
          businessCapabilities: {
            canManageTeam: true,
            canReviewDepartment: false,
            canViewPerformanceApproval: false,
            canOperatePerformanceApproval: false,
            canHandleHrCycle: false,
            canHandleInterviews: false,
            canHandleProbationReviews: false,
            canHandleConfirmationApprovals: false,
            canViewReports: false,
            canManageObjectives: false,
            identities: [],
          },
        })),
      });
    }

    if (path === '/api/v1/cycles/mine') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse([{
          id: 'cycle-logout',
          planVersion: 1,
          name: '退出验收周期',
          type: 'quarterly',
          startDate: '2026-07-01',
          endDate: '2026-09-30',
          status: 'goal_setting',
          publishVisibleFields: {
            totalScore: true,
            grade: true,
            indicatorScores: true,
            managerComment: true,
            coefficient: false,
          },
          gradeAMaxRatio: 0.2,
          gradeBMaxRatio: 0.4,
          gradeCMaxRatio: 0.3,
          gradeDMaxRatio: 0.1,
        }])),
      });
    }

    if (path === '/api/v1/tasks/mine') {
      if (!authenticated) {
        unauthorizedTaskRequests += 1;
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Unauthorized' }),
        });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 100, items: [] })),
      });
    }

    if (path === '/api/v1/tasks/team') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({
          total: 0,
          page: 1,
          pageSize: 20,
          items: [],
          counts: { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 },
          facets: { departments: [], employees: [] },
        })),
      });
    }

    if (path === '/api/v1/users/manager-logout/subordinates') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse([])),
      });
    }

    if (path === '/api/v1/notifications/unread-count') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ count: 0 })),
      });
    }

    return route.fulfill({ status: 404, body: 'not mocked' });
  });

  return () => unauthorizedTaskRequests;
}

test('主管从团队绩效待办退出时不再发起无凭证任务查询', async ({ page }) => {
  const unauthorizedTaskRequests = await mockManagerTaskWorkspace(page);

  await page.goto('/tasks?scope=team&stage=goal-review&stageState=pending');
  await expect(page).toHaveURL(/\/tasks/);
  await expect(page.getByTestId('performance-workspace-title')).toHaveText('绩效待办');

  await page.getByTestId('header-user-menu').click();
  await page.getByTestId('header-logout').click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await page.waitForLoadState('networkidle');

  expect(unauthorizedTaskRequests()).toBe(0);
  await expect(page.locator('.el-message')).toHaveCount(0);
});

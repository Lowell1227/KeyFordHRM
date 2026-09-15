import { expect, test, type Page } from '@playwright/test';

const envelope = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });

async function mockAuthenticatedAdmin(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'business-list-full-migration-test');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ json: envelope({
        id: 'admin',
        name: '模板验收管理员',
        sysRole: 'system_admin',
        status: 'active',
        canViewAll: true,
        hrCapabilities: [
          'cycle_plan_edit',
          'cycle_plan_review',
          'performance_calibration',
          'performance_publish',
          'employee_archive_edit',
          'employee_archive_review',
          'organization_edit',
          'confirmation_manage',
        ],
        businessCapabilities: {
          canManageTeam: true,
          canReviewDepartment: true,
          canViewDepartmentReview: true,
          canOperateDepartmentReview: true,
          canViewPerformanceCalibration: true,
          canOperatePerformanceCalibration: true,
          canViewPerformanceApproval: true,
          canOperatePerformanceApproval: true,
          canHandleInterviews: true,
          canManageImprovementPlans: true,
          canHandleProbationReviews: true,
          canHandleConfirmationApprovals: true,
        },
      }) });
    }
    if (path.endsWith('/notifications/unread-count')) return route.fulfill({ json: envelope({ count: 0 }) });
    return route.abort();
  });
}

const routes = [
  ['/interviews', 'record'],
  ['/templates', 'record'],
  ['/positions', 'record'],
  ['/approval', 'workflow'],
  ['/calibration', 'workflow'],
  ['/publish', 'workflow'],
  ['/personnel-change-reviews', 'workflow'],
  ['/probation-reviews/manage', 'workflow'],
  ['/probation-reviews/manager', 'workflow'],
  ['/probation-reviews/mine', 'workflow'],
  ['/confirmation-applications/approvals', 'workflow'],
  ['/confirmation-applications/mine', 'workflow'],
  ['/improvement-plans', 'workflow'],
] as const;

test('all active migration pages use their approved business-list template', async ({ page }) => {
  await mockAuthenticatedAdmin(page);

  for (const [path, variant] of routes) {
    await page.goto(path);
    const listPage = page.getByTestId('business-list-page');
    await expect(listPage, path).toHaveAttribute('data-list-variant', variant);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    })), { message: path }).toEqual({ documentOverflow: 0, bodyOverflow: 0 });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

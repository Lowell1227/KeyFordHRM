import { expect, test, type Page } from '@playwright/test';
import { routes as appRoutes } from '../../src/router/routes';

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
  ['/confirmation-applications/manage', 'workflow'],
  ['/confirmation-applications/mine', 'workflow'],
  ['/improvement-plans', 'workflow'],
] as const;

test('workflow list routes own their reusable detail routes', () => {
  const expected = new Map<string, string[]>([
    ['/improvement-plans', ['ImprovementPlanDetail']],
    ['/confirmation-applications/manage', ['ConfirmationManageDetail']],
    ['/confirmation-applications/mine', ['ConfirmationMineDetail']],
    ['/probation-reviews/manage', ['ProbationManageDetail']],
    ['/probation-reviews/manager', ['ProbationManagerDetail']],
    ['/probation-reviews/mine', ['ProbationMineDetail']],
    ['/department-review', ['DepartmentReviewDetail']],
  ]);

  for (const [path, names] of expected) {
    const route = appRoutes.find((item) => item.path === path);
    expect(route?.children?.map((child) => child.name), path).toEqual(names);
  }
});

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

test('legacy confirmation approval URLs redirect into the canonical management page', async ({ page }) => {
  await mockAuthenticatedAdmin(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/confirmation-applications/approvals');
  await expect(page).toHaveURL(/\/confirmation-applications\/manage$/);
  const listPage = page.getByTestId('business-list-page');
  await expect(listPage.locator(':scope > .business-list-page__header')).toBeVisible();
  await expect(listPage.locator(':scope > .business-list-page__results')).toBeVisible();
});

test('confirmation, probation and department-review direct URLs stay inside workflow drawers', async ({ page }) => {
  await mockAuthenticatedAdmin(page);
  await page.route('**/api/v1/confirmation-applications/confirmation-drawer', (route) => route.fulfill({ json: envelope({
    id: 'confirmation-drawer', employeeId: 'employee', employee: { id: 'employee', name: '抽屉验收员工' },
    status: 'approved', manager: { id: 'manager', name: '直属主管' }, hr: { id: 'hr', name: 'HR 经办人' },
    companyApprover: { id: 'approver', name: '公司审批人' }, roster: {}, workflowVersion: 2,
    canViewInternalMeeting: false, canApprove: false, pendingRole: null, steps: [], history: [], meetingAttachments: [],
  }) }));
  await page.route('**/api/v1/probation-reviews/probation-drawer', (route) => route.fulfill({ json: envelope({
    id: 'probation-drawer', status: 'closed', employee: { id: 'employee', name: '试用期员工' },
    manager: { id: 'manager', name: '直属主管' }, hr: { id: 'hr', name: 'HR 经办人' },
    plannedRegularDate: '2026-09-30', indicators: [], signatures: [], strengths: null, improvements: null,
  }) }));
  await page.route('**/api/v1/tasks/department-drawer', (route) => route.fulfill({ json: envelope({
    id: 'department-drawer', cycleId: 'cycle', cycleName: '抽屉验收周期', employeeId: 'employee',
    employeeName: '部门复核员工', employeeNo: 'E001', deptName: '业务部', position: '专员',
    managerId: 'manager', managerName: '直属主管', deptHeadId: 'admin', status: 'dept_review',
    approvedAt: null, isExempt: false, workflowVersion: 2, periods: [], indicatorInstances: [], flowRecords: [],
    gradeResult: { calculatedScore: 90, rawGrade: 'B', calibratedGrade: null, isPublished: false },
    workflowContext: { stage: 'review', statusLabel: '待部门复核', currentHandler: null, canRemind: false },
  }) }));

  for (const [path, parentPath] of [
    ['/confirmation-applications/approvals/confirmation-drawer', '/confirmation-applications/manage'],
    ['/confirmation-applications/mine/confirmation-drawer', '/confirmation-applications/mine'],
    ['/probation-reviews/manage/probation-drawer', '/probation-reviews/manage'],
    ['/department-review/department-drawer', '/department-review'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByTestId('business-list-page'), path).toHaveAttribute('data-list-variant', 'workflow');
    await expect(page.getByTestId('business-detail-drawer'), path).toHaveAttribute('data-drawer-variant', 'workflow');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`${parentPath}$`));
    await expect(page.getByTestId('business-list-page')).toBeVisible();
  }
});

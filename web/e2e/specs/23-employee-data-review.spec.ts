import { expect, test } from '@playwright/test';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const webBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test('HR can review profile and performance changes together without one invalid row blocking the rest', async ({ page }) => {
  const employee = {
    id: 'employee-1', name: '员工一', employeeNo: '001', deptId: 'dept-1', deptName: '项目中心',
    position: '项目专员', employmentType: 'full_time', status: 'active', directManagerId: 'manager-old',
    directManagerName: '原绩效上级', sysRole: 'employee', isAssessorOnly: false, canViewAll: false,
    dingtalkBindingState: 'unbound',
  };
  const reviews = [
    {
      id: '11111111-1111-4111-8111-111111111111', userId: 'employee-1', employeeNo: '001', employeeName: '员工一',
      sourceType: 'employee_roster_import', profileReviewStatus: 'pending', performanceReviewStatus: 'pending',
      validationErrors: [], baseValue: { employee: { position: '项目助理' }, performance: { managerId: 'manager-old' } },
      proposedValue: { employee: { position: '项目专员' }, performance: { managerId: 'manager-new', managerName: '新绩效上级' } },
      createdAt: '2026-08-23T08:00:00.000Z', updatedAt: '2026-08-23T08:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222', userId: 'employee-2', employeeNo: '002', employeeName: '员工二',
      sourceType: 'employee_roster_import', profileReviewStatus: 'not_required', performanceReviewStatus: 'pending',
      validationErrors: ['绩效直属上级待设置'], baseValue: {},
      proposedValue: { employee: { position: '设计师' }, performance: { managerId: null } },
      createdAt: '2026-08-23T08:01:00.000Z', updatedAt: '2026-08-23T08:01:00.000Z',
    },
  ];
  let approveBody: unknown;

  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-admin-token');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'admin-1', name: '系统管理员', deptId: null, sysRole: 'system_admin', isAssessorOnly: false, canViewAll: true,
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: 'dept-1', name: '项目中心', parentId: null, company: 'fuede', sortOrder: 1, isActive: true,
      directMemberCount: 1, memberCount: 1, children: [],
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 20, items: [employee] })),
  }));
  await page.route('**/api/v1/employee-archives/reviews/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 2, page: 1, pageSize: 20, items: reviews })),
  }));
  await page.route('**/api/v1/employee-archives/reviews/approve', async (route) => {
    approveBody = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        succeeded: [{ requestId: reviews[0].id, scopes: ['profile', 'performance'] }],
        failed: [{ requestId: reviews[1].id, reason: '绩效直属上级待设置' }],
      })),
    });
  });

  await page.goto(`${webBaseUrl}/users`);
  await page.getByRole('button', { name: '员工名册' }).click();
  await page.getByRole('button', { name: '待审核变更 2' }).click();

  const workspace = page.locator('.review-workspace');
  await expect(workspace.getByText('员工一', { exact: true })).toBeVisible();
  await expect(workspace.getByText('员工二', { exact: true })).toBeVisible();
  await expect(workspace.getByText('基础档案审核', { exact: true })).toBeVisible();
  await expect(workspace.getByText('绩效关系审核', { exact: true })).toBeVisible();
  await expect(workspace.getByText('需补充', { exact: true })).toBeVisible();

  const rowChecks = workspace.locator('.el-table__body-wrapper .el-checkbox');
  await rowChecks.nth(0).click();
  await rowChecks.nth(1).click();
  await workspace.getByRole('button', { name: '通过可审核项（2）' }).click();

  await expect.poll(() => approveBody).toEqual({
    requestIds: [reviews[0].id, reviews[1].id],
    scopes: ['profile', 'performance'],
  });
  await expect(page.getByText('已通过 1 人；1 人需补充信息')).toBeVisible();
});

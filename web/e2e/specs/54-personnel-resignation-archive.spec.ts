import { expect, test } from '@playwright/test';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });

test('员工草稿、办理离职和手动归档使用彼此独立的入口', async ({ page }) => {
  const activeEmployee = {
    id: '10000000-0000-4000-8000-000000000001', name: '在职员工', employeeNo: '001',
    deptId: '30000000-0000-4000-8000-000000000001', deptName: '人事部', position: '专员',
    employmentType: 'full_time', status: 'active', directManagerId: null, directManagerName: null,
    sysRole: 'employee', systemPermission: 'standard_user', businessIdentities: [],
    isAssessorOnly: false, canViewAll: false, dingtalkBindingState: 'enabled', archivedAt: null,
  };
  const resignedEmployee = {
    ...activeEmployee,
    id: '10000000-0000-4000-8000-000000000002',
    name: '离职员工',
    employeeNo: '002',
    status: 'resigned',
    dingtalkBindingState: 'disabled',
  };
  const archive = {
    ...activeEmployee,
    dept: { id: activeEmployee.deptId, name: '人事部', fullPath: '人事行政部 / 人事部', company: 'fuede' },
    performanceManager: null,
    rosterManager: null,
    currentEmployment: {
      id: 'employment-1', company: 'fuede', deptId: activeEmployee.deptId, positionId: null,
      position: '专员', jobGrade: null, jobFamily: null, directManagerId: null, workLocation: null,
      employmentType: 'full_time', employeeStatus: 'active', entryDate: '2025-01-01',
      plannedRegularDate: null, actualRegularDate: null, leaveDate: null, probationMonths: null,
    },
    employmentHistory: [],
    employeeProfile: null,
    employeeContracts: [],
    dingtalkBinding: null,
  };
  const archivedArchive = {
    ...archive,
    ...resignedEmployee,
    archivedAt: '2026-09-15T02:00:00.000Z',
    currentEmployment: { ...archive.currentEmployment, employeeStatus: 'resigned', leaveDate: '2026-09-15' },
  };
  const draft = {
    id: '50000000-0000-4000-8000-000000000001', userId: null, employeeNo: '003', employeeName: '草稿员工',
    sourceType: 'manual_employee_create', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
    validationErrors: [], baseValue: {}, recordStatus: 'draft', archivedAt: null,
    proposedValue: { employee: { employeeNo: '003', name: '草稿员工' }, performance: {} },
    createdBy: { id: 'hr-1', name: 'HR管理员', sysRole: 'hr' },
    createdAt: '2026-09-15T01:00:00.000Z', updatedAt: '2026-09-15T01:00:00.000Z',
  };
  let resignationBody: Record<string, unknown> | null = null;
  let archivedEmployeeIds: string[] = [];
  let archivedDraftIds: string[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-hr-token');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'hr-1', name: 'HR管理员', sysRole: 'hr', canViewAll: true,
      hrCapabilities: ['employee_archive_edit', 'employee_archive_review'],
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: activeEmployee.deptId, name: '人事部', fullPath: '人事行政部 / 人事部', parentId: null,
      company: 'fuede', sortOrder: 1, isActive: true, directMemberCount: 2, memberCount: 2, children: [],
    }])),
  }));
  await page.route('**/api/v1/positions**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse([])),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 2, page: 1, pageSize: 20, items: [activeEmployee, resignedEmployee] })),
  }));
  await page.route('**/api/v1/employee-archives/drafts/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 100, items: [draft] })),
  }));
  await page.route('**/api/v1/employee-archives/drafts/archive', async (route) => {
    archivedDraftIds = route.request().postDataJSON().ids;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ archived: 1 })) });
  });
  await page.route('**/api/v1/employee-archives/archive', async (route) => {
    archivedEmployeeIds = route.request().postDataJSON().ids;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ archived: 1 })) });
  });
  await page.route(`**/api/v1/employee-archives/${activeEmployee.id}`, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(archive)),
  }));
  await page.route(`**/api/v1/employee-archives/${resignedEmployee.id}`, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(archivedArchive)),
  }));
  await page.route(`**/api/v1/employee-archives/${activeEmployee.id}/employments`, async (route) => {
    resignationBody = route.request().postDataJSON();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ id: 'review-1' })) });
  });

  await page.goto('/users');
  await expect(page.getByRole('button', { name: '草稿箱' })).toBeVisible();
  await expect(page.getByRole('button', { name: '已归档' })).toBeVisible();
  await expect(page.getByRole('button', { name: '归档', exact: true })).toBeDisabled();

  const activeRow = page.locator('.desktop-result-table .el-table__row').filter({ hasText: '在职员工' });
  await activeRow.getByRole('button', { name: '办理离职' }).click();
  const resignationDrawer = page.getByRole('dialog', { name: '办理离职' });
  await expect(resignationDrawer.getByText('不会自动归档')).toBeVisible();
  await resignationDrawer.locator('.el-form-item').filter({ hasText: '离职原因' }).locator('textarea').fill('个人原因');
  await resignationDrawer.getByRole('button', { name: '提交审核' }).click();
  await expect.poll(() => resignationBody).toMatchObject({
    changeType: 'resignation', employeeStatus: 'resigned', reason: '个人原因',
  });

  const resignedRow = page.locator('.desktop-result-table .el-table__row').filter({ hasText: '离职员工' });
  await resignedRow.locator('.el-checkbox').click();
  await page.getByRole('button', { name: '归档', exact: true }).click();
  await page.getByRole('dialog', { name: '归档离职员工' }).getByRole('button', { name: '确认归档' }).click();
  await expect.poll(() => archivedEmployeeIds).toEqual([resignedEmployee.id]);

  await page.getByRole('button', { name: '已归档' }).click();
  const archivedRow = page.locator('.desktop-result-table .el-table__row').filter({ hasText: '离职员工' });
  await archivedRow.getByRole('button', { name: '查看档案' }).click();
  const archivedDrawer = page.getByRole('dialog', { name: '员工档案' });
  await expect(archivedDrawer.getByRole('button', { name: '编辑档案' })).toHaveCount(0);
  await expect(archivedDrawer.getByRole('button', { name: '新增任职记录' })).toHaveCount(0);
  await archivedDrawer.getByLabel('关闭此对话框').click();
  await page.getByRole('button', { name: '返回员工档案' }).click();

  await page.getByRole('button', { name: '草稿箱' }).click();
  const draftDialog = page.getByRole('dialog', { name: '人事档案草稿' });
  await expect(draftDialog.getByText('草稿员工')).toBeVisible();
  await draftDialog.locator('.el-table__body-wrapper .el-checkbox').click();
  await draftDialog.getByRole('button', { name: '归档所选' }).click();
  await page.getByRole('dialog', { name: '归档草稿' }).getByRole('button', { name: '确认归档' }).click();
  await expect.poll(() => archivedDraftIds).toEqual([draft.id]);

  await draftDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '新增员工' }).click();
  const createDrawer = page.getByRole('dialog', { name: '新增员工' });
  await expect(createDrawer.getByRole('button', { name: '保存草稿' })).toBeVisible();
  await expect(createDrawer.getByRole('button', { name: '提交审核' })).toBeVisible();
});

import { expect, test } from '@playwright/test';

const apiResponse = (data: unknown) => ({
  code: 0,
  message: 'success',
  data,
  timestamp: Date.now(),
});

const webBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test('HR administrator reviews employee and department changes from the independent personnel review menu', async ({ page }) => {
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
      validationErrors: [],
      baseValue: {
        employee: { position: '项目助理' },
        performance: { managerId: 'manager-old' },
        contracts: [{
          id: 'contract-1', name: '劳动合同', signingCompany: '孚德',
          signedAt: '2024-01-01', effectiveFrom: '2024-01-02', expiresAt: '2026-12-31',
        }],
      },
      proposedValue: {
        employee: { position: '项目专员' },
        performance: { managerId: 'manager-new', managerName: '新绩效上级' },
        contracts: [{
          id: 'contract-1', name: '劳动合同', signingCompany: '孚德体育文化',
          signedAt: '2024-01-01', effectiveFrom: '2024-02-01', expiresAt: '2026-12-31',
        }],
      },
      createdBy: { id: 'ordinary-hr-1', name: '余焱玲', sysRole: 'hr_user' },
      createdAt: '2026-08-23T08:00:00.000Z', updatedAt: '2026-08-23T08:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222', userId: 'employee-2', employeeNo: '002', employeeName: '员工二',
      sourceType: 'employee_roster_import', profileReviewStatus: 'not_required', performanceReviewStatus: 'pending',
      validationErrors: ['绩效直属上级待设置'], baseValue: {},
      proposedValue: { employee: { position: '设计师' }, performance: { managerId: null } },
      createdBy: { id: 'ordinary-hr-1', name: '余焱玲', sysRole: 'hr_user' },
      createdAt: '2026-08-23T08:01:00.000Z', updatedAt: '2026-08-23T08:01:00.000Z',
    },
  ];
  const departmentChange = {
    id: '33333333-3333-4333-8333-333333333333',
    action: 'update_structure', status: 'pending', departmentId: 'dept-1', departmentName: '项目中心',
    baseValue: { name: '项目中心', parentId: null },
    proposedValue: { name: '项目管理中心', parentId: null },
    createdBy: { id: 'ordinary-hr-1', name: '余焱玲', sysRole: 'hr_user' },
    createdAt: '2026-08-23T08:02:00.000Z', updatedAt: '2026-08-23T08:02:00.000Z',
  };
  const positionChange = {
    id: '44444444-4444-4444-8444-444444444444',
    positionId: null, positionName: '项目经理', action: 'create', status: 'pending',
    baseValue: {}, proposedValue: { code: 'PM', jobFamily: '项目管理' }, warnings: [],
    createdBy: { id: 'ordinary-hr-1', name: '余焱玲' },
    createdAt: '2026-08-23T08:03:00.000Z',
  };
  let approveBody: unknown;
  let approvedDepartmentId: string | null = null;
  let approvedPositionId: string | null = null;

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
  await page.route('**/api/v1/departments/change-requests**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 20, items: [departmentChange] })),
      });
    }
    if (route.request().url().endsWith('/approve')) {
      approvedDepartmentId = departmentChange.id;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ ...departmentChange, status: 'approved' })),
      });
    }
    return route.fallback();
  });
  await page.route('**/api/v1/positions/change-requests**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 20, items: [positionChange] })),
      });
    }
    if (route.request().url().endsWith('/approve')) {
      approvedPositionId = positionChange.id;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(apiResponse({ ...positionChange, status: 'approved' })),
      });
    }
    return route.fallback();
  });

  await page.goto(`${webBaseUrl}/personnel-change-reviews`);
  await expect(page.getByRole('button', { name: '人事变更审核', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /待处理事项/ })).toHaveCount(0);
  await expect(page.locator('.personnel-review-hero')).toHaveCount(0);

  const workspace = page.locator('.pending-review-workspace');
  await expect(workspace.getByRole('button', { name: '全部 4' })).toHaveClass(/active/);
  await expect(workspace.getByRole('button', { name: '员工档案 2' })).toBeVisible();
  await expect(workspace.getByRole('button', { name: '组织架构 1' })).toBeVisible();
  await expect(workspace.getByRole('button', { name: '岗位目录 1' })).toBeVisible();
  const reviewTables = workspace.locator('.review-category-section > .review-table');
  await expect(reviewTables).toHaveCount(3);
  const expectedReviewColumns = ['变更类型', '审核对象', '变更内容', '提交人', '提交时间', '操作'];
  for (let index = 0; index < 3; index += 1) {
    await expect.poll(async () => (
      reviewTables.nth(index).locator('.el-table__header-wrapper th .cell').allTextContents()
    ).then((items) => items.map((item) => item.trim()).filter(Boolean))).toEqual(expectedReviewColumns);
    await expect(reviewTables.nth(index).getByRole('button', { name: '退回', exact: true }).first()).toBeVisible();
    await expect(reviewTables.nth(index).getByRole('button', { name: '通过', exact: true }).first()).toBeVisible();
  }
  await expect(workspace.getByText('可审核', { exact: true })).toHaveCount(0);
  await expect(workspace.locator('.department-review-card')).toHaveCount(0);
  await expect(workspace.getByText('员工一', { exact: true })).toBeVisible();
  await expect(workspace.getByText('员工二', { exact: true })).toBeVisible();
  await expect(workspace.getByText('项目中心 → 项目管理中心')).toBeVisible();
  await expect(workspace.getByText('项目经理', { exact: true })).toBeVisible();
  await expect(workspace.getByText('余焱玲', { exact: true }).first()).toBeVisible();
  await expect(workspace.getByText('基础档案审核', { exact: true })).toHaveCount(0);
  await expect(workspace.getByText('绩效关系审核', { exact: true })).toHaveCount(0);
  await expect(workspace.getByText('无变更', { exact: true })).toHaveCount(0);
  await expect(workspace.getByText('需补充', { exact: true })).toBeVisible();
  await expect(workspace.getByText(/合同修改/)).toBeVisible();
  await workspace.locator('.el-table__expand-icon').first().click();
  await expect(workspace.getByText('合同变更明细', { exact: true })).toBeVisible();
  await expect(workspace.getByText('变更前：签约公司：孚德；签订日期：2024-01-01；生效日期：2024-01-02；到期日期：2026-12-31')).toBeVisible();
  await expect(workspace.getByText('变更后：签约公司：孚德体育文化；签订日期：2024-01-01；生效日期：2024-02-01；到期日期：2026-12-31')).toBeVisible();

  const rowChecks = reviewTables.nth(0).locator('.el-table__body-wrapper .el-checkbox');
  await rowChecks.nth(0).click();
  await rowChecks.nth(1).click();
  await workspace.getByRole('button', { name: '批量通过（2）' }).click();

  await expect.poll(() => approveBody).toEqual({
    requestIds: [reviews[0].id, reviews[1].id],
    scopes: ['profile', 'performance'],
  });
  await expect(page.getByText('已通过 1 人；1 人需补充信息')).toBeVisible();

  await workspace.getByRole('button', { name: '组织架构 1' }).click();
  await expect(workspace.getByText('项目中心 → 项目管理中心')).toBeVisible();
  await expect(workspace.getByText('余焱玲', { exact: true })).toBeVisible();
  await workspace.locator('.review-table .el-table__body-wrapper .el-checkbox').click();
  await workspace.getByRole('button', { name: '批量通过（1）' }).click();
  await expect.poll(() => approvedDepartmentId).toBe(departmentChange.id);

  await workspace.getByRole('button', { name: '岗位目录 1' }).click();
  await workspace.locator('.review-table .el-table__body-wrapper .el-checkbox').click();
  await workspace.getByRole('button', { name: '批量通过（1）' }).click();
  await expect.poll(() => approvedPositionId).toBe(positionChange.id);
});

test('department context menu uses the full edit drawer and unassigned people can be submitted in batch', async ({ page }) => {
  const departments = [{
    id: 'dept-1', name: '项目中心', fullPath: '项目中心', parentId: null, company: 'fuede',
    leaderId: 'manager-1', leaderName: '负责人甲', approverId: null, sortOrder: 1, isActive: true,
    directMemberCount: 1, memberCount: 1, children: [],
  }];
  const unassigned = [
    { id: 'employee-1', name: '待分配甲', employeeNo: '001' },
    { id: 'employee-2', name: '待分配乙', employeeNo: '002' },
  ].map((item) => ({
    ...item, deptId: null, deptName: null, position: '专员', employmentType: 'full_time', status: 'active',
    directManagerId: null, directManagerName: null, sysRole: 'employee', systemPermission: 'standard_user',
    businessIdentities: [], isAssessorOnly: false, canViewAll: false, dingtalkBindingState: 'unbound',
  }));
  let structureBody: unknown;
  let deleteRequested = false;
  let assignmentBody: unknown;
  let queriedUnassigned = false;

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
  await page.route('**/api/v1/positions**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: 'position-1', code: 'SPECIALIST', name: '专员', jobFamily: null, isActive: true, activeEmployeeCount: 2,
    }])),
  }));
  await page.route('**/api/v1/departments**', async (route) => {
    if (route.request().method() === 'PATCH') {
      structureBody = route.request().postDataJSON();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ id: 'change-edit', status: 'pending' })) });
    }
    if (route.request().method() === 'DELETE') {
      deleteRequested = true;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ id: 'change-delete', status: 'pending' })) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(departments)) });
  });
  await page.route('**/api/v1/users**', (route) => {
    const url = new URL(route.request().url());
    const isUnassigned = url.searchParams.get('unassigned') === 'true';
    queriedUnassigned ||= isUnassigned;
    const items = isUnassigned ? unassigned : [unassigned[0]];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: items.length, page: 1, pageSize: 20, items })),
    });
  });
  await page.route('**/api/v1/employee-archives/department-assignments', (route) => {
    assignmentBody = route.request().postDataJSON();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ submitted: 2 })) });
  });

  await page.goto(`${webBaseUrl}/organization`);
  const treeNode = page.locator('.dept-node').filter({ hasText: '项目中心' });
  await treeNode.click({ button: 'right' });
  await page.locator('.department-context-menu').getByRole('button', { name: '编辑' }).click();
  const drawer = page.getByRole('dialog', { name: '编辑部门' });
  await expect(drawer).toContainText('基础信息');
  await expect(drawer).toContainText('组织职责');
  await expect(drawer).toContainText('影响范围');
  await drawer.getByRole('textbox', { name: '部门名称' }).fill('项目管理中心');
  await drawer.getByRole('button', { name: '保存并提交审核' }).click();
  await expect.poll(() => structureBody).toMatchObject({
    name: '项目管理中心', company: 'fuede', parentId: null, leaderId: 'manager-1', approverId: null,
  });

  await treeNode.click({ button: 'right' });
  await page.locator('.department-context-menu').getByRole('button', { name: '停用' }).click();
  await expect(page.getByText(/仍有 .*直属人员/)).toBeVisible();
  await page.getByRole('button', { name: '提交停用审核' }).click();
  await expect.poll(() => deleteRequested).toBe(true);

  await page.getByRole('button', { name: /未分配人员/ }).click();
  await expect.poll(() => queriedUnassigned).toBe(true);
  await expect(page.getByText('待分配甲', { exact: true })).toBeVisible();
  await page.locator('.org-detail .el-table__header-wrapper .el-checkbox').click();
  await page.getByRole('button', { name: '批量归属部门（2）' }).click();
  const assignmentDialog = page.getByRole('dialog', { name: '批量归属部门' });
  await assignmentDialog.getByRole('combobox').click();
  await page.locator('.el-select-dropdown:visible').getByText('项目中心', { exact: true }).click();
  await assignmentDialog.getByRole('button', { name: '提交审核' }).click();
  await page.getByRole('dialog', { name: '调整人员归属' }).getByRole('button', { name: '提交审核' }).click();
  await expect.poll(() => assignmentBody).toEqual({
    userIds: ['employee-1', 'employee-2'], departmentId: 'dept-1',
  });
});

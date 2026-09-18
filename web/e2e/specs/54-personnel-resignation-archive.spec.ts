import { expect, test } from '@playwright/test';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });

test('员工分类贴近列表，草稿页内维护，归档动作统一', async ({ page }) => {
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
  const resignedEmployeeTwo = {
    ...resignedEmployee,
    id: '10000000-0000-4000-8000-000000000003',
    name: '离职员工二',
    employeeNo: '003',
  };
  const archive = {
    ...activeEmployee,
    dept: { id: activeEmployee.deptId, name: '人事部', fullPath: '人事行政部 / 人事部', company: 'fuede' },
    performanceManager: null,
    rosterManager: null,
    currentEmployment: {
      id: 'employment-1', effectiveFrom: '2025-01-01', effectiveTo: null,
      company: 'fuede', deptId: activeEmployee.deptId, positionId: null,
      position: '专员', jobGrade: null, jobFamily: null, directManagerId: null, workLocation: null,
      employmentType: 'full_time', employeeStatus: 'active', entryDate: '2025-01-01',
      plannedRegularDate: null, actualRegularDate: null, leaveDate: null, probationMonths: null,
    },
    employmentHistory: [{
      id: 'employment-1', effectiveFrom: '2025-01-01', effectiveTo: null,
      company: 'fuede', deptId: activeEmployee.deptId, positionId: null,
      position: '专员', jobGrade: null, jobFamily: null, directManagerId: null, workLocation: null,
      employmentType: 'full_time', employeeStatus: 'active', entryDate: '2025-01-01',
      plannedRegularDate: null, actualRegularDate: null, leaveDate: null, probationMonths: null,
    }],
    employeeProfile: null,
    employeeContracts: [],
    dingtalkBinding: null,
    latestResignationReview: null,
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
  const archivedDraft = {
    ...draft,
    id: '50000000-0000-4000-8000-000000000002',
    employeeNo: '004',
    employeeName: '已归档草稿',
    recordStatus: 'archived',
    archivedAt: '2026-09-15T02:30:00.000Z',
  };
  let resignationBody: Record<string, unknown> | null = null;
  let archivedEmployeeIds: string[] = [];
  let archivedDraftIds: string[] = [];
  const userQueryUrls: string[] = [];
  const draftQueryUrls: string[] = [];

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
  await page.route('**/api/v1/users**', (route) => {
    const url = new URL(route.request().url());
    userQueryUrls.push(url.toString());
    let items = [activeEmployee];
    if (url.searchParams.get('archived') === 'true') items = [{ ...resignedEmployee, archivedAt: archivedArchive.archivedAt }];
    else if (url.searchParams.get('status') === 'resigned') items = [resignedEmployee, resignedEmployeeTwo];
    else if (url.searchParams.get('includeResigned') === 'true') items = [activeEmployee, resignedEmployee, resignedEmployeeTwo];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: items.length, page: 1, pageSize: 20, items })),
    });
  });
  await page.route('**/api/v1/employee-archives/drafts/list**', (route) => {
    const url = new URL(route.request().url());
    draftQueryUrls.push(url.toString());
    const items = url.searchParams.get('state') === 'archived' ? [archivedDraft] : [draft];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ total: 1, page: 1, pageSize: 20, items })),
    });
  });
  await page.route('**/api/v1/employee-archives/drafts/archive', async (route) => {
    archivedDraftIds = route.request().postDataJSON().ids;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ archived: 1 })) });
  });
  await page.route('**/api/v1/employee-archives/archive', async (route) => {
    archivedEmployeeIds = route.request().postDataJSON().ids;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ archived: 2 })) });
  });
  await page.route(`**/api/v1/employee-archives/${activeEmployee.id}`, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(archive)),
  }));
  await page.route(`**/api/v1/employee-archives/${resignedEmployee.id}`, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(archivedArchive)),
  }));
  await page.route(`**/api/v1/employee-archives/${resignedEmployeeTwo.id}`, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse({ ...archivedArchive, ...resignedEmployeeTwo })),
  }));
  await page.route(`**/api/v1/employee-archives/${resignedEmployee.id}/reentry/current`, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(null)),
  }));
  await page.route(`**/api/v1/employee-archives/${activeEmployee.id}/employments`, async (route) => {
    resignationBody = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        id: '50000000-0000-4000-8000-000000000099',
        userId: activeEmployee.id,
        employeeNo: activeEmployee.employeeNo,
        employeeName: activeEmployee.name,
        sourceType: 'manual_employment_change',
        profileReviewStatus: 'pending',
        performanceReviewStatus: 'not_required',
        validationErrors: [],
        validationWarnings: [],
        baseValue: {},
        proposedValue: { employee: { changeType: 'resignation', leaveDate: '2026-09-16' } },
        createdBy: { id: 'hr-1', name: 'HR管理员', sysRole: 'hr' },
        profileReviewedBy: null,
        performanceReviewedBy: null,
        rejectedReason: null,
        profileReviewedAt: null,
        appliedAt: null,
        createdAt: '2026-09-16T02:00:00.000Z',
        updatedAt: '2026-09-16T02:00:00.000Z',
        recordStatus: 'submitted',
        archivedAt: null,
      })),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/users');
  await expect(page.getByTestId('business-list-page')).toHaveAttribute('data-list-variant', 'record');
  const categoryTabs = page.getByRole('tablist', { name: '员工档案分类' });
  const filterPanel = page.locator('.roster-filter-panel');
  await expect(page.locator('.roster-scope-panel')).toHaveCount(0);
  await expect(filterPanel.getByRole('combobox', { name: '部门' })).toBeVisible();
  await expect.poll(async () => {
    const filterBox = await filterPanel.boundingBox();
    const categoryBox = await categoryTabs.boundingBox();
    return Boolean(filterBox && categoryBox && filterBox.y < categoryBox.y);
  }).toBeTruthy();
  await filterPanel.getByRole('combobox', { name: '部门' }).click();
  await page.getByRole('option', { name: '人事行政部 / 人事部' }).click();
  await filterPanel.getByRole('button', { name: '查询' }).click();
  await expect.poll(() => userQueryUrls.some((url) => (
    new URL(url).searchParams.get('deptId') === activeEmployee.deptId
  ))).toBeTruthy();
  await expect(categoryTabs.getByRole('tab')).toHaveText(['全部', '在职', '试用期', '待入职', '已离职', '草稿', '已归档']);
  await expect(categoryTabs.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => userQueryUrls.some((url) => new URL(url).searchParams.get('includeResigned') === 'true')).toBeTruthy();
  await expect(page.getByRole('button', { name: '草稿箱' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '归档所选（0）', exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('全部状态')).toHaveCount(0);
  const archiveAction = page.locator('.page-title__actions').getByRole('button', { name: '归档', exact: true });
  await expect(archiveAction).toBeDisabled();

  const activeRow = page.locator('.desktop-result-table .el-table__row').filter({ hasText: '在职员工' });
  await activeRow.getByRole('button', { name: '办理离职' }).click();
  const resignationDrawer = page.getByRole('dialog', { name: '办理离职' });
  await expect(resignationDrawer.getByRole('heading', { name: '审批流程' })).toBeVisible();
  await expect(resignationDrawer.getByText('待提交', { exact: true })).toBeVisible();
  await expect(resignationDrawer.getByText('不会自动归档')).toBeVisible();
  await expect(resignationDrawer.getByText('与 1 条已有任职记录时间重叠，仅作提醒，不影响提交和审核')).toBeVisible();
  await resignationDrawer.locator('.el-form-item').filter({ hasText: '离职原因' }).locator('textarea').fill('个人原因');
  await resignationDrawer.getByRole('button', { name: '提交审核' }).click();
  await expect.poll(() => resignationBody).toMatchObject({
    changeType: 'resignation', employeeStatus: 'resigned', reason: '个人原因',
  });
  await expect(resignationDrawer).toBeVisible();
  await expect(resignationDrawer.getByText('待 HR 审核', { exact: true })).toBeVisible();
  await expect(resignationDrawer.getByText('HR管理员 · 2026/09/16 10:00', { exact: true })).toBeVisible();
  await expect(resignationDrawer.getByRole('button', { name: '关闭', exact: true })).toBeVisible();
  await expect(resignationDrawer.getByRole('button', { name: '提交审核' })).toHaveCount(0);
  await resignationDrawer.getByRole('button', { name: '关闭', exact: true }).click();

  await categoryTabs.getByRole('tab', { name: '已离职' }).click();
  await expect.poll(() => userQueryUrls.some((url) => new URL(url).searchParams.get('status') === 'resigned')).toBeTruthy();
  const resignedRow = page.locator('.desktop-result-table .el-table__row').filter({ hasText: '离职员工' });
  await resignedRow.filter({ hasNotText: '离职员工二' }).locator('.el-checkbox').click();
  const resignedRowTwo = page.locator('.desktop-result-table .el-table__row').filter({ hasText: '离职员工二' });
  await resignedRowTwo.locator('.el-checkbox').click();
  await expect(archiveAction).toBeEnabled();
  await archiveAction.click();
  await page.getByRole('dialog', { name: '归档离职员工' }).getByRole('button', { name: '确认归档' }).click();
  await expect.poll(() => archivedEmployeeIds).toEqual([resignedEmployee.id, resignedEmployeeTwo.id]);

  await categoryTabs.getByRole('tab', { name: '已归档' }).click();
  await expect.poll(() => userQueryUrls.some((url) => new URL(url).searchParams.get('archived') === 'true')).toBeTruthy();
  const archivedRow = page.locator('.desktop-result-table .el-table__row').filter({ hasText: '离职员工' }).filter({ hasNotText: '离职员工二' });
  await archivedRow.getByRole('button', { name: '办理再入职' }).click();
  const reentryDrawer = page.getByRole('dialog', { name: '办理再入职' });
  await expect(reentryDrawer.getByText('再入职将自动生成新工号')).toBeVisible();
  await expect(reentryDrawer.getByText('花名册直属主管', { exact: true })).toBeVisible();
  await expect(reentryDrawer.getByText('绩效直属上级', { exact: true })).toBeVisible();
  await reentryDrawer.getByLabel('关闭此对话框').click();
  await archivedRow.getByRole('button', { name: '查看档案' }).click();
  const archivedDrawer = page.getByRole('dialog', { name: '员工档案' });
  await expect(archivedDrawer.getByRole('button', { name: '编辑档案' })).toHaveCount(0);
  await expect(archivedDrawer.getByRole('button', { name: '新增任职记录' })).toHaveCount(0);
  await archivedDrawer.getByLabel('关闭此对话框').click();

  await categoryTabs.getByRole('tab', { name: '草稿' }).click();
  await expect(page.getByRole('dialog', { name: '人事档案草稿' })).toHaveCount(0);
  const draftWorkspace = page.locator('.draft-workspace');
  await expect(draftWorkspace.locator('.desktop-result-table').getByText('草稿员工')).toBeVisible();
  await draftWorkspace.locator('.el-table__body-wrapper .el-checkbox').click();
  await expect(archiveAction).toBeEnabled();
  await archiveAction.click();
  const archiveDraftDialog = page.getByRole('dialog', { name: '归档草稿' });
  await archiveDraftDialog.getByRole('button', { name: '确认归档' }).click();
  await expect.poll(() => archivedDraftIds).toEqual([draft.id]);
  await expect(archiveDraftDialog).toBeHidden();

  await draftWorkspace.getByText('已归档草稿', { exact: true }).first().click();
  await expect(draftWorkspace.locator('.desktop-result-table').getByText('已归档草稿')).toBeVisible();
  await expect.poll(() => draftQueryUrls.some((url) => new URL(url).searchParams.get('state') === 'archived')).toBeTruthy();

  await page.getByRole('button', { name: '新增员工' }).click();
  const createDrawer = page.getByRole('dialog', { name: '新增员工' });
  await expect(createDrawer.getByRole('button', { name: '保存并退出' })).toBeVisible();
  await expect(createDrawer.getByRole('button', { name: '下一步' })).toBeVisible();
  await expect(createDrawer.getByRole('button', { name: '提交审核' })).toHaveCount(0);
  await expect(createDrawer.getByText('员工工号将在提交审核时自动生成')).toBeVisible();
  await expect(createDrawer.getByLabel('工号')).toHaveCount(0);
  await createDrawer.getByLabel('关闭此对话框').click();

  await categoryTabs.getByRole('tab', { name: '全部' }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.desktop-result-table')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.roster-mobile-list')).toBeVisible();
  await expect(page.getByRole('button', { name: '选择范围' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
  }))).toEqual({ documentOverflow: 0, bodyOverflow: 0 });
});

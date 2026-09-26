import { expect, test, type Page } from '@playwright/test';
import { applicationProgress } from '../../src/utils/employee-lifecycle';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });

test('普通档案撤回及部分生效后的撤回呈现明确状态', () => {
  const cancelled = { recordStatus: 'submitted', profileReviewStatus: 'cancelled', performanceReviewStatus: 'not_required', cancelledAt: '2026-09-26T00:00:00Z', proposedValue: {} };
  expect(applicationProgress(cancelled as any)).toBe('已取消');
  expect(applicationProgress({ ...cancelled, profileReviewStatus: 'approved', performanceReviewStatus: 'cancelled', appliedAt: '2026-09-25T00:00:00Z' } as any)).toBe('部分已生效，其余已取消');
});

const department = {
  id: '30000000-0000-4000-8000-000000000001',
  name: '人事部',
  fullPath: '人事行政部 / 人事部',
  parentId: null,
  company: 'fuede',
  sortOrder: 1,
  isActive: true,
  directMemberCount: 0,
  memberCount: 0,
  children: [],
};

async function setupPersonnelPage(page: Page, options: {
  initialDraft?: Record<string, any> | null;
  draftDelayMs?: number;
} = {}) {
  const draftBodies: Array<Record<string, any>> = [];
  const createBodies: Array<Record<string, any>> = [];
  const events: string[] = [];
  let currentDraft: Record<string, any> | null = options.initialDraft ?? null;
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
    contentType: 'application/json', body: JSON.stringify(apiResponse([department])),
  }));
  await page.route('**/api/v1/positions**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: '40000000-0000-4000-8000-000000000001',
      code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true, activeEmployeeCount: 0,
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/employee-archives/drafts/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      total: currentDraft ? 1 : 0,
      page: 1,
      pageSize: 20,
      items: currentDraft ? [currentDraft] : [],
    })),
  }));
  await page.route('**/api/v1/employee-archives/drafts', async (route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    draftBodies.push(body);
    events.push('draft-start');
    if (options.draftDelayMs) await new Promise((resolve) => setTimeout(resolve, options.draftDelayMs));
    currentDraft = {
      id: 'draft-create-1', userId: null, employeeNo: null, employeeName: body.name,
      sourceType: 'manual_employee_create', profileReviewStatus: 'pending',
      performanceReviewStatus: body.performanceManagerId ? 'pending' : 'not_required',
      validationErrors: [], validationWarnings: [], baseValue: {}, recordStatus: 'draft',
      proposedValue: {
        employee: body.employee, profile: body.profile, contracts: body.contracts,
        performance: body.performance,
        draftMeta: { currentStep: body.draftStep, completedSteps: body.completedSteps, layoutVersion: body.draftLayoutVersion },
      },
      createdAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-18T08:00:00.000Z',
    };
    events.push('draft-finished');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(currentDraft)) });
  });
  await page.route('**/api/v1/employee-archives', async (route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    createBodies.push(body);
    events.push('create');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({ id: 'submitted-1', ...body, recordStatus: 'submitted' })),
    });
  });
  await page.route('**/api/v1/employee-archives/diagnostics', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse({ blocking: false, total: 0, items: [] })),
  }));
  return { draftBodies, createBodies, events, getDraft: () => currentDraft };
}

test('新增员工采用四步向导，任职关系同页且补充资料可跳过', async ({ page }) => {
  await setupPersonnelPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/users');
  await page.getByRole('button', { name: '新增员工' }).click();

  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await expect(drawer.locator('.el-step')).toHaveCount(4);
  await expect(drawer.getByRole('button', { name: '保存并退出' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '下一步' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '提交审核' })).toHaveCount(0);
  await expect(drawer.getByText('员工工号将在提交审核时自动生成')).toBeVisible();
  await drawer.getByLabel('姓名', { exact: true }).fill('分步员工');
  await drawer.getByRole('button', { name: '下一步' }).click();
  await expect(drawer.getByText('花名册直属主管', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('绩效直属上级', { exact: true }).first()).toBeVisible();
  await drawer.getByRole('button', { name: '下一步' }).click();
  await expect(drawer.getByRole('button', { name: '个人与教育' })).toBeVisible();
  await drawer.getByRole('button', { name: '下一步' }).click();
  await expect(drawer.getByRole('button', { name: '提交审核' })).toBeVisible();
});

test('输入姓名后静默自动保存并从上次步骤继续填写', async ({ page }) => {
  const state = await setupPersonnelPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/users');
  await page.getByRole('button', { name: '新增员工' }).click();

  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await drawer.getByLabel('姓名').fill('草稿员工');
  await drawer.getByRole('button', { name: '下一步' }).click();
  await expect.poll(() => state.draftBodies.at(-1)).toMatchObject({
    name: '草稿员工', draftStep: 1, completedSteps: [0], saveMode: 'auto',
  });
  expect(state.draftBodies.at(-1)?.deptId).not.toBe('');
  expect(state.draftBodies.at(-1)?.entryDate).not.toBe('');
  expect(state.draftBodies.at(-1)?.employee.leaveDate).toBeNull();
  expect(state.draftBodies.at(-1)?.profile.birthDate).toBeNull();
  await expect(drawer.getByText('已保存', { exact: true })).toBeVisible();
  await expect(page.getByText('草稿已保存，尚未提交审核')).toHaveCount(0);

  await drawer.getByRole('button', { name: '保存并退出' }).click();
  await expect(drawer).toHaveCount(0);
  await page.getByText('草稿', { exact: true }).click();
  await expect(page.getByText('草稿员工', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).first().click();

  const resumed = page.getByRole('dialog', { name: '新增员工' });
  await expect(resumed.locator('.el-step__title.is-process')).toHaveText('本次任职');
  await resumed.getByLabel('入职日期').fill('2026-09-18');
  await resumed.getByLabel('入职日期').press('Enter');
  await expect(resumed.getByLabel('本次记录生效日期')).toHaveValue('2026-09-18');
  await expect(resumed.getByLabel('预计转正日期')).toHaveValue('2026-12-18');
});

test('提交审核会等待正在进行的自动保存完成', async ({ page }) => {
  const initialDraft = {
    id: 'draft-create-1', userId: null, employeeNo: null, employeeName: '待提交员工',
    sourceType: 'manual_employee_create', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
    validationErrors: [], validationWarnings: [], baseValue: {}, recordStatus: 'draft',
    proposedValue: {
      employee: {
        name: '待提交员工', phone: null, company: 'fuede', deptId: department.id,
        entryDate: '2026-09-18', effectiveFrom: '2026-09-18', employmentType: 'full_time',
        employeeStatus: 'probation', probationMonths: 3, plannedRegularDate: '2026-12-18',
      },
      profile: {}, contracts: [], performance: { managerId: null },
      draftMeta: { currentStep: 6, completedSteps: [0, 1, 2, 3, 4, 5] },
    },
    createdAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-18T08:00:00.000Z',
  };
  const state = await setupPersonnelPage(page, { initialDraft, draftDelayMs: 900 });
  await page.goto('/users');
  await page.getByText('草稿', { exact: true }).click();
  await page.getByRole('button', { name: '继续编辑' }).click();

  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await drawer.getByLabel('姓名').evaluate((input: HTMLInputElement) => {
    input.value = '待提交员工（更新）';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => state.events).toContain('draft-start');
  await drawer.getByRole('button', { name: '提交审核' }).click();
  await expect.poll(() => state.createBodies.length).toBe(1);

  expect(state.events.indexOf('draft-finished')).toBeLessThan(state.events.indexOf('create'));
  expect(state.createBodies[0]).toMatchObject({ draftId: 'draft-create-1', name: '待提交员工（更新）' });
});

test('390px 手机宽度下向导保持单列且可继续填写', async ({ page }) => {
  await setupPersonnelPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/users');
  await page.getByRole('button', { name: '新增员工' }).click();

  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await expect(drawer.locator('.mobile-step')).toHaveText('1/4 基本信息');
  await expect(drawer.locator('.desktop-steps')).toBeHidden();
  await drawer.getByLabel('姓名').fill('手机端员工');
  await drawer.getByRole('button', { name: '下一步' }).click();
  await expect(drawer.locator('.mobile-step')).toHaveText('2/4 本次任职');
  await expect(drawer.getByLabel('所属公司')).toBeVisible();
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

function completeDraft() {
  return {
    id: 'draft-create-1', userId: null, employeeNo: null, employeeName: '测试办理员工',
    sourceType: 'manual_employee_create', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
    validationErrors: [], validationWarnings: [], baseValue: {}, recordStatus: 'draft',
    proposedValue: { employee: { name: '测试办理员工', company: 'fuede', deptId: department.id, entryDate: '2026-10-08', effectiveFrom: '2026-10-08', employmentType: 'full_time', employeeStatus: 'probation' }, profile: {}, contracts: [], performance: { managerId: null }, draftMeta: { layoutVersion: 2, currentStep: 0, completedSteps: [] } },
    createdAt: '2026-09-26T08:00:00.000Z', updatedAt: '2026-09-26T08:00:00.000Z',
  };
}

test('手机号同号人工确认在提交强制复查后仍有效，非法证件不能借有效手机号跳过', async ({ page }) => {
  const state = await setupPersonnelPage(page, { initialDraft: completeDraft() });
  await page.route('**/api/v1/employee-archives/identity-lookup', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ outcome: 'phone_candidates', candidates: [{ id: 'other-user', maskedName: '其*', currentEmployeeNo: '999', matchedHistoricalEmployeeNo: null, status: 'active', archived: false, departmentName: '人事部', matchBasis: 'phone', nextAction: 'confirm_phone' }] })) }));
  await page.goto('/users');
  await page.getByRole('tab', { name: '草稿', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑' }).click();
  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await drawer.getByLabel('手机号', { exact: true }).fill('19900000001');
  await drawer.getByRole('button', { name: '检索已有档案' }).click();
  await drawer.getByText('已核对，以上人员均不是本次新增员工', { exact: true }).click();
  await drawer.getByLabel('身份证号', { exact: true }).fill('123');
  for (let index = 0; index < 3; index += 1) await drawer.getByRole('button', { name: '下一步' }).click();
  await drawer.getByRole('button', { name: '提交审核' }).click();
  await expect(drawer.getByText('请填写完整的身份证号，或清空后稍后补充')).toBeVisible();
  expect(state.createBodies).toHaveLength(0);
  await drawer.getByLabel('身份证号', { exact: true }).clear();
  await drawer.getByRole('button', { name: '检索已有档案' }).click();
  await drawer.getByText('已核对，以上人员均不是本次新增员工', { exact: true }).click();
  for (let index = 0; index < 3; index += 1) await drawer.getByRole('button', { name: '下一步' }).click();
  await drawer.getByRole('button', { name: '提交审核' }).click();
  await expect.poll(() => state.createBodies.length).toBe(1);
  expect(state.createBodies[0]).toMatchObject({ draftId: 'draft-create-1', phoneDuplicateAcknowledged: true });
  expect(state.createBodies[0]?.employee.leaveDate).toBeNull();
  expect(state.createBodies[0]?.profile.birthDate).toBeNull();
});

test('自动保存失败不会关闭抽屉或丢失输入，可重试保存', async ({ page }) => {
  await setupPersonnelPage(page);
  await page.route('**/api/v1/employee-archives/drafts', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '暂时无法保存' }) }));
  await page.goto('/users');
  await page.getByRole('button', { name: '新增员工' }).click();
  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await drawer.getByLabel('姓名', { exact: true }).fill('保留输入员工');
  await drawer.getByRole('button', { name: '保存并退出' }).click();
  await expect(drawer.getByText(/草稿保存失败，输入内容仍保留/)).toBeVisible();
  await expect(drawer.getByLabel('姓名', { exact: true })).toHaveValue('保留输入员工');
  await expect(drawer).toBeVisible();
});

test('办理中一人一行，退回申请可从原内容续填，不要求审核权限', async ({ page }) => {
  await setupPersonnelPage(page);
  const draft = { ...completeDraft(), recordStatus: 'submitted', profileReviewStatus: 'rejected', rejectedReason: '请补充信息', canResume: true };
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ id: 'ordinary-hr', name: '普通人事', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] })) }));
  await page.route('**/api/v1/employee-archives/applications/list**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ items: [draft], total: 1, page: 1, pageSize: 100 })) }));
  await page.route('**/api/v1/employee-archives/applications/draft-create-1', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(draft)) }));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/users');
  await page.getByRole('tab', { name: '办理中', exact: true }).click();
  await expect(page.locator('.desktop-result-table .el-table__body tbody > tr')).toHaveCount(1);
  await page.getByRole('button', { name: '查看申请', exact: true }).first().click();
  await page.getByRole('button', { name: '修改后重新提交' }).click();
  const drawer = page.getByRole('dialog', { name: '新增员工' });
  await expect(drawer.getByLabel('姓名', { exact: true })).toHaveValue('测试办理员工');
  await expect(drawer.getByText('已退回：请补充信息')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('归档员工可批量取消归档，当前档案和任职合同变更分区，普通HR不能切换钉钉登录', async ({ page }) => {
  await setupPersonnelPage(page);
  const employee = { id: 'archive-user', name: '归档历史员工', employeeNo: '88', status: 'resigned', archivedAt: '2026-09-20T00:00:00Z', deptId: department.id, deptName: department.name, position: '专员', sysRole: 'employee', systemPermission: 'standard_user', businessIdentities: [], dingtalkBindingState: 'disabled', currentApplications: [] };
  let restored: string[] = [];
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ id: 'ordinary-hr', name: '普通人事', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] })) }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ items: [employee], total: 1, page: 1, pageSize: 20 })) }));
  await page.route('**/api/v1/employee-archives/archive-user', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ ...employee, dept: department, performanceManager: null, rosterManager: null, currentEmployment: null, employeeProfile: {}, employmentHistory: [{ id: 'employment-old', employeeNo: '88', effectiveFrom: '2025-01-01', effectiveTo: '2026-09-19', employeeStatus: 'resigned', changeType: 'hire', dept: department, position: '专员', entryDate: '2025-01-01' }], employeeContracts: [], dingtalkBinding: { id: 'binding', status: 'disabled' }, changeHistory: [{ ...completeDraft(), id: 'history-request', employeeName: '归档历史员工', userId: employee.id, profileReviewStatus: 'approved', recordStatus: 'submitted', appliedAt: '2026-09-19T00:00:00Z', onboardingStatus: 'effective' }], employeeNumberAssignments: [{ id: 'number88', employeeNo: '88', status: 'historical' }] })) }));
  await page.route('**/api/v1/employee-archives/restore', (route) => { restored = route.request().postDataJSON().ids; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ restored: 1, succeeded: [{ id: employee.id }], failed: [] })) }); });
  await page.goto('/users');
  await page.getByRole('tab', { name: '已归档', exact: true }).click();
  await page.locator('.desktop-result-table .el-table__row .el-checkbox').click();
  await page.locator('.page-title__actions').getByRole('button', { name: '取消归档', exact: true }).click();
  await page.getByRole('dialog', { name: '取消归档', exact: true }).getByRole('button', { name: '取消归档', exact: true }).click();
  await expect.poll(() => restored).toEqual(['archive-user']);
  await page.getByRole('button', { name: '查看档案' }).first().click();
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await expect(drawer.getByRole('tab')).toHaveText(['当前档案', '任职历史', '合同材料', '变更记录']);
  await expect(drawer.getByRole('switch')).toHaveCount(0);
  await drawer.getByRole('tab', { name: '任职历史', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '工号 88', exact: true })).toBeVisible();
  await drawer.getByRole('tab', { name: '变更记录', exact: true }).click();
  await expect(drawer.locator('.change-history .el-collapse-item')).toHaveCount(1);
});

test('仅组织维护权限不出现档案编辑或草稿入口', async ({ page }) => {
  await setupPersonnelPage(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ id: 'organization-hr', name: '组织专员', sysRole: 'hr_user', hrCapabilities: ['organization_edit'] })) }));
  await page.goto('/users');
  await expect(page.getByRole('button', { name: '新增员工' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '草稿', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '办理中', exact: true })).toHaveCount(0);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`四步抽屉在 ${viewport.width}px 下独立滚动且底部操作可见`, async ({ page }, testInfo) => {
    await setupPersonnelPage(page, { initialDraft: completeDraft() });
    await page.setViewportSize(viewport);
    await page.goto('/users');
    await page.getByRole('tab', { name: '草稿', exact: true }).click();
    await page.getByRole('button', { name: '继续编辑' }).first().click();
    const drawer = page.getByRole('dialog', { name: '新增员工' });
    await drawer.getByRole('button', { name: '下一步' }).click();
    await drawer.getByRole('button', { name: '下一步' }).click();
    await drawer.getByRole('button', { name: '个人与教育' }).click();
    await expect(drawer.getByRole('button', { name: '个人与教育' })).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => drawer.locator('.supplement-groups .el-collapse-item__wrap').first().evaluate((element) => element.clientHeight)).toBeGreaterThan(300);
    const next = await drawer.getByRole('button', { name: '下一步' }).boundingBox();
    expect(next!.y + next!.height).toBeLessThanOrEqual(viewport.height);
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`employee-wizard-${viewport.width}.png`), fullPage: true });
  });
}

for (const intakeType of ['reentry', 'new_hire']) test(`${intakeType} 已生效任职的绩效关系被退回时，只允许修订该关系`, async ({ page }) => {
  await setupPersonnelPage(page);
  const employee = { id: 'reentry-user', name: '再入职员工', employeeNo: '123', status: 'active', deptId: department.id, deptName: department.name, position: 'HRBP', sysRole: 'employee' };
  const request = { ...completeDraft(), id: 'reentry-request', userId: employee.id, user: employee, employeeName: employee.name, intakeType, recordStatus: 'submitted', onboardingStatus: 'effective', profileReviewStatus: 'approved', performanceReviewStatus: 'rejected', canResume: true, rejectedReason: '请核对绩效上级', proposedValue: { employee: { company: 'fuede', deptId: department.id, effectiveDate: '2026-09-18', employeeStatus: 'active', employmentType: 'full_time' }, performance: { managerId: null } } };
  let revised: unknown;
  await page.route('**/api/v1/employee-archives/reentry/reentry-request', (route) => { revised = route.request().postDataJSON(); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ ...request, performanceReviewStatus: 'pending' })) }); });
  await page.route('**/api/v1/users/reentry-user', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(employee)) }));
  await page.route('**/api/v1/employee-archives/applications/list**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ items: [request], total: 1, page: 1, pageSize: 100 })) }));
  await page.route('**/api/v1/employee-archives/applications/reentry-request', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(request)) }));
  await page.route('**/api/v1/employee-archives/reentry-user/reentry/current', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(request)) }));
  await page.goto('/users');
  await page.getByRole('tab', { name: '办理中', exact: true }).click();
  await page.locator('.desktop-result-table').getByRole('button', { name: '查看申请', exact: true }).first().click();
  await page.getByRole('dialog', { name: '办理记录', exact: true }).getByRole('button', { name: '修改后重新提交' }).click();
  const drawer = page.getByRole('dialog', { name: intakeType === 'new_hire' ? '修改入职绩效关系' : '办理再入职', exact: true });
  await expect(drawer.getByRole('button', { name: '重新提交绩效关系' })).toBeVisible();
  await expect(drawer.getByLabel('再入职日期', { exact: true })).toBeDisabled();
  await expect(drawer.getByText('绩效直属上级', { exact: true }).locator('..').getByRole('combobox')).toBeEnabled();
  await drawer.getByRole('button', { name: '重新提交绩效关系' }).click();
  await expect.poll(() => revised).toEqual({ performanceOnly: true, performanceManagerId: null });
  await expect(drawer.getByRole('button', { name: '更新并重新提交' })).toHaveCount(0);
});

import { test, expect, type Page } from '@playwright/test';
const response = (data: unknown) => ({ code: 0, data, message: 'success', timestamp: Date.now() });
for (const width of [1440, 1024, 390]) {
  test(`administrator maintains subjects at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1024 ? 768 : 900 });
    await page.addInitScript(() => { localStorage.setItem('token', 'test'); localStorage.setItem('expiresAt', String(Date.now() + 3600000)); });
    let rows = [{ id: 'subject-a', name: '合成主体甲有限公司（长名称验收：跨区域项目服务与运营管理合同主体，仅用于合成测试）', isActive: true, createdAt: '', updatedAt: '' }];
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = [];
      if (path.endsWith('/auth/me')) data = { id: 'admin', name: '合成管理员', sysRole: 'system_admin', canViewAll: true };
      if (path.endsWith('/notifications/unread-count')) data = 0;
      if (path.includes('/contract-subjects')) {
        const body = route.request().method() === 'GET' ? null : route.request().postDataJSON();
        if (route.request().method() === 'POST') rows.push({ id: 'subject-b', ...body, isActive: true, createdAt: '', updatedAt: '' });
        if (route.request().method() === 'PATCH') rows = rows.map(row => path.endsWith(row.id) ? { ...row, ...body } : row);
        data = route.request().method() === 'GET' ? rows : rows.at(-1);
      }
      await route.fulfill({ json: response(data) });
    });
    await page.goto('/contract-subjects');
    await page.getByRole('button', { name: '新增主体', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: '主体名称' }).fill('新建合成主体有限公司');
    await page.getByRole('button', { name: '保存主体', exact: true }).click();
    await expect(page.getByText('新建合成主体有限公司', { exact: true }).filter({ visible: true })).toBeVisible();
    const row = page.locator(width === 390 ? '.mobile-result-card' : '.el-table__row').filter({ hasText: '新建合成主体有限公司' });
    await row.getByRole('button', { name: '修改名称', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: '主体名称' }).fill('  更名合成主体有限公司  ');
    await page.getByRole('button', { name: '保存主体', exact: true }).click();
    const renamed = page.locator(width === 390 ? '.mobile-result-card' : '.el-table__row').filter({ hasText: '更名合成主体有限公司' });
    await renamed.getByRole('button', { name: '停用', exact: true }).click();
    await page.getByRole('button', { name: '停用主体', exact: true }).click();
    await expect(renamed.getByText('停用', { exact: true }).first()).toBeVisible();
    await renamed.getByRole('button', { name: '启用', exact: true }).click();
    await page.getByRole('button', { name: '启用主体', exact: true }).click();
    await expect(renamed.getByText('启用', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect(page.locator('.el-message-box')).not.toBeVisible();
    await page.screenshot({ path: `../tmp/contract-subject-maintenance-20261029/subjects-${width}.png`, fullPage: true });
  });
}

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
  const archivedDraftIds: string[] = [];
  const events: string[] = [];
  let currentDraft: Record<string, any> | null = options.initialDraft ?? null;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-hr-token');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(response({
      id: 'hr-1', name: 'HR管理员', sysRole: 'hr', canViewAll: true,
      hrCapabilities: ['employee_archive_edit', 'employee_archive_review'],
    })),
  }));
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response([department])),
  }));
  await page.route('**/api/v1/positions**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(response([{
      id: '40000000-0000-4000-8000-000000000001',
      code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true, activeEmployeeCount: 0,
    }])),
  }));
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(response({ total: 0, page: 1, pageSize: 20, items: [] })),
  }));
  await page.route('**/api/v1/employee-archives/drafts/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(response({
      total: currentDraft ? 1 : 0,
      page: 1,
      pageSize: 20,
      items: currentDraft ? [currentDraft] : [],
    })),
  }));
  await page.route('**/api/v1/employee-archives/drafts/archive', async (route) => {
    const body = route.request().postDataJSON() as { ids: string[] };
    archivedDraftIds.push(...body.ids);
    currentDraft = null;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response({
      archived: body.ids.length,
      succeeded: body.ids.map((id) => ({ id })),
      failed: [],
    })) });
  });
  await page.route('**/api/v1/employee-archives/applications/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(response({ total: 0, page: 1, pageSize: 100, items: [] })),
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
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response(currentDraft)) });
  });
  await page.route('**/api/v1/employee-archives', async (route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    createBodies.push(body);
    events.push('create');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(response({ id: 'submitted-1', ...body, recordStatus: 'submitted' })),
    });
  });
  await page.route('**/api/v1/employee-archives/diagnostics', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(response({ blocking: false, total: 0, items: [] })),
  }));
  return { draftBodies, createBodies, archivedDraftIds, events, getDraft: () => currentDraft };
}


for (const width of [1440, 390]) {
  test(`shared subjects survive new-hire draft and refresh at ${width}px`, async ({ page }) => {
    const state = await setupPersonnelPage(page);
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: response({
      id: 'hr-1', name: '合成档案HR', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'],
    }) }));
    await page.setViewportSize({ width, height: 900 });
    let subjects = [{ id: 'subject-a', name: '合成任职主体有限公司', isActive: true }, { id: 'subject-b', name: '合成合同主体有限公司', isActive: true }];
    await page.route('**/api/v1/contract-subjects**', route => route.fulfill({ json: response(subjects) }));
    await page.goto('/personnel-processing');
    await page.getByRole('button', { name: '新增员工', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '新增员工', exact: true });
    await drawer.getByLabel('姓名', { exact: true }).fill('合成主体员工');
    await drawer.getByRole('button', { name: '下一步', exact: true }).click();
    const subjectField = drawer.locator('.el-form-item').filter({ has: page.getByText('所属公司（合同主体）', { exact: true }) });
    await subjectField.getByRole('combobox').click();
    await page.getByRole('option', { name: '合成任职主体有限公司' }).click();
    await expect(subjectField.getByRole('link', { name: '维护主体（新窗口）' })).toHaveAttribute('target', '_blank');
    subjects = [...subjects, { id: 'subject-c', name: '刚新增的合成主体', isActive: true }];
    await subjectField.getByRole('button', { name: '刷新主体' }).click();
    await expect(subjectField.getByText('合成任职主体有限公司 · 已关联')).toBeVisible();
    await drawer.getByRole('button', { name: '下一步', exact: true }).click();
    await drawer.getByRole('button', { name: '合同与附件', exact: true }).click();
    await drawer.getByRole('button', { name: '新增合同', exact: true }).click();
    const contractField = drawer.locator('.el-form-item').filter({ has: page.getByText('签约公司', { exact: true }) });
    await contractField.getByRole('combobox').click();
    await page.getByRole('option', { name: '合成合同主体有限公司' }).click();
    await drawer.getByRole('button', { name: '保存并退出', exact: true }).click();
    await expect.poll(() => state.draftBodies.at(-1)?.employee.contractSubjectId).toBe('subject-a');
    expect(state.draftBodies.at(-1)?.contracts[0].contractSubjectId).toBe('subject-b');
    expect(state.draftBodies.at(-1)?.employee.company).toBe('fuede');
    await page.getByRole('tab', { name: '草稿', exact: true }).click();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(drawer.getByText('合成任职主体有限公司 · 已关联')).toBeVisible();
    await drawer.screenshot({ path: `../tmp/contract-subject-maintenance-20261029/new-hire-${width}.png` });
  });
}

for (const { capability, canMaintain, width } of [
  { capability: 'employee_archive_edit', canMaintain: true, width: 1440 },
  { capability: 'employee_archive_edit', canMaintain: true, width: 390 },
  { capability: 'employee_archive_review', canMaintain: false, width: 1440 },
]) test(`ordinary HR ${capability} directory actions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.addInitScript(() => { localStorage.setItem('token', 'mock'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  const rows = [{ id: 'a', name: '可选合成主体', isActive: true }];
  let submittedName = '';
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/contract-subjects') && route.request().method() === 'POST') {
      submittedName = route.request().postDataJSON().name;
      rows.push({ id: 'b', name: submittedName, isActive: true });
    }
    return route.fulfill({ json: response(path.endsWith('/auth/me') ? { id: 'ordinary', name: '合成HR', sysRole: 'hr_user', hrCapabilities: [capability] } : path.includes('/contract-subjects') ? rows : 0) });
  });
  await page.goto('/contract-subjects');
  await expect(page.getByText('可选合成主体', { exact: true }).filter({ visible: true })).toBeVisible();
  const createButton = page.getByRole('button', { name: '新增主体', exact: true });
  if (canMaintain) {
    await expect(page.getByRole('button', { name: '修改名称', exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停用', exact: true }).filter({ visible: true })).toBeVisible();
    await createButton.click();
    await page.getByRole('dialog').getByRole('textbox', { name: '主体名称' }).fill('普通HR新增合成主体');
    await page.getByRole('button', { name: '保存主体', exact: true }).click();
    await expect.poll(() => submittedName).toBe('普通HR新增合成主体');
    await expect(page.getByText(submittedName, { exact: true }).filter({ visible: true })).toBeVisible();
  } else {
    await expect(createButton).toHaveCount(0);
    await expect(page.getByRole('button', { name: '修改名称', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '停用', exact: true })).toHaveCount(0);
  }
});

for (const linked of [false, true]) {
  test(`archive unrelated edit preserves ${linked ? 'inactive ID and frozen names' : 'legacy unlinked names'}`, async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('token', 'mock'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
    const employee = { id: 'archive-person', name: '合成档案员工', employeeNo: 'SYNTH', deptId: 'dept-1', status: 'active', sysRole: 'employee' };
    const employment = { id: 'employment', company: 'fuede', companyText: '冻结的任职名称', contractSubjectId: linked ? 'inactive' : null, employeeStatus: 'active', employmentType: 'full_time', effectiveFrom: '2024-01-01', deptId: 'dept-1' };
    const contract = { id: 'contract', signingCompany: '冻结的合同名称', contractSubjectId: linked ? 'inactive' : null, name: '合成劳动合同', isActive: true, contractType: 'contract', sequence: 0 };
    let submitted: any;
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = [];
      if (path.endsWith('/auth/me')) data = { id: 'admin', name: '合成管理员', sysRole: 'system_admin', canViewAll: true };
      else if (path.endsWith('/notifications/unread-count')) data = 0;
      else if (path.endsWith('/contract-subjects')) data = [{ id: 'inactive', name: '目录改名后的主体', isActive: false }, { id: 'active', name: '启用主体', isActive: true }];
      else if (path.endsWith('/users')) data = { items: [employee], total: 1, page: 1, pageSize: 20 };
      else if (path.endsWith('/departments')) data = [{ id: 'dept-1', name: '合成部门', company: 'fuede', children: [] }];
      else if (path.endsWith('/employee-archives/archive-person')) data = { ...employee, employeeProfile: null, currentEmployment: employment, employmentHistory: [employment], employeeContracts: [contract], dept: { id: 'dept-1', name: '合成部门', company: 'fuede' }, changeHistory: [], rosterManager: null, performanceManager: null };
      else if (path.endsWith('/archive-person/draft')) { submitted = route.request().postDataJSON(); data = { id: 'review' }; }
      else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
      return route.fulfill({ json: response(data) });
    });
    await page.goto('/users');
    await page.getByRole('button', { name: '查看档案', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
    await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
    const field = drawer.locator('.el-form-item').filter({ has: page.getByText('所属公司（合同主体）', { exact: true }) });
    await expect(field.getByText(linked ? '冻结的任职名称 · 已关联，主体已停用' : '冻结的任职名称 · 原记录，尚未关联')).toBeVisible();
    await field.getByRole('button', { name: '刷新主体' }).click();
    await drawer.getByLabel('姓名', { exact: true }).fill('合成档案更名');
    await drawer.getByRole('button', { name: '提交审核', exact: true }).click();
    await expect.poll(() => submitted?.employee.name).toBe('合成档案更名');
    expect(submitted.employee.companyText).toBe('冻结的任职名称');
    expect(submitted.contracts[0].signingCompany).toBe('冻结的合同名称');
    expect(submitted.employee.contractSubjectId).toBe(linked ? 'inactive' : undefined);
    expect(submitted.contracts[0].contractSubjectId).toBe(linked ? 'inactive' : undefined);
  });
}

test('empty directory and load/save errors preserve input and allow retry', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('token', 'mock'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  let failLoad = true;
  let failSave = true;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: response({ id: 'admin', name: '合成管理员', sysRole: 'hr', canViewAll: true }) });
    if (path.includes('/contract-subjects')) {
      if ((route.request().method() === 'GET' && failLoad) || (route.request().method() === 'POST' && failSave)) return route.fulfill({ status: 500, json: { message: '合成失败' } });
      return route.fulfill({ json: response([]) });
    }
    return route.fulfill({ json: response(0) });
  });
  await page.goto('/contract-subjects');
  await expect(page.getByText('合同主体加载失败，请点击刷新重试。')).toBeVisible();
  failLoad = false;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByText('暂无合同主体', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: '新增主体', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '保存主体' }).click();
  await expect(dialog.getByText('请填写 1–150 字主体名称')).toBeVisible();
  await dialog.getByRole('textbox', { name: '主体名称' }).fill('合成失败后保留主体');
  await dialog.getByRole('button', { name: '保存主体' }).click();
  await expect(dialog.getByText('主体保存失败，请核对名称或稍后重试；输入已保留。')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '主体名称' })).toHaveValue('合成失败后保留主体');
  failSave = false;
  await dialog.getByRole('button', { name: '保存主体' }).click();
  await expect(dialog).not.toBeVisible();
});

test('same-name ID-only changes remain visible in review details', async ({ page }) => {
  await setupPersonnelPage(page);
  const request = { id: 'association-review', userId: 'synthetic', employeeName: '合成关联员工', sourceType: 'manual_archive_change', recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', validationErrors: [], validationWarnings: [], createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z', events: [], createdBy: { id: 'hr', name: '合成HR' }, baseValue: { employee: { companyText: '同名主体', contractSubjectId: null }, contracts: [{ id: 'c', name: '合成合同', signingCompany: '同名主体', contractSubjectId: 'old' }] }, proposedValue: { employee: { companyText: '同名主体', contractSubjectId: 'new' }, contracts: [{ id: 'c', name: '合成合同', signingCompany: '同名主体', contractSubjectId: 'new' }] } };
  await page.route('**/api/v1/employee-archives/applications/list**', route => route.fulfill({ json: response({ items: [request], total: 1, page: 1, pageSize: 20 }) }));
  await page.route('**/api/v1/employee-archives/applications/association-review', route => route.fulfill({ json: response(request) }));
  await page.goto('/personnel-processing');
  await page.getByRole('button', { name: '查看办理详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '档案修改办理详情', exact: true });
  await expect(detail.getByText('合同主体关联', { exact: true })).toBeVisible();
  await expect(detail.getByText('尚未关联 → 新主体关联', { exact: true })).toBeVisible();
  await expect(detail.getByText('合成合同 · 合同主体关联', { exact: true })).toBeVisible();
  await expect(detail.getByText('原主体关联 → 新主体关联', { exact: true })).toBeVisible();
});

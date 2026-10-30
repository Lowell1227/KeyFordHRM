import { expect, test, type Page } from '@playwright/test';

const response = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });
const employee = {
  id: 'synthetic-employee', name: '合成人员', employeeNo: 'SYN001', status: 'active', employmentType: 'full_time',
  sysRole: 'employee', deptName: '合成部门', position: '合成岗位', directManagerName: '',
  hrCapabilities: [], businessIdentities: [], isAssessorOnly: false, canViewAll: false,
  archiveIssueCount: 2, archiveWarnings: [],
};
const draft = {
  id: 'synthetic-source-draft', userId: null, employeeNo: null, employeeName: '合成待核资料',
  sourceType: 'manual_employee_create', recordStatus: 'draft', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
  validationErrors: [], validationWarnings: [{ field: 'employee.employeeStatus', message: '员工状态待核实' }],
  baseValue: {}, proposedValue: { employee: { name: '合成待核资料', company: null, probationMonths: null, deptId: 'synthetic-department', entryDate: '2026-10-01', effectiveFrom: '2026-10-01', employeeStatus: null, employmentType: null },
    profile: {}, performance: {}, contracts: [], draftMeta: { layoutVersion: 2, currentStep: 1 } },
  archiveIssueCount: 2, createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z',
};
const conflict = {
  id: 'company-conflict', requestId: 'synthetic-request', employeeId: employee.id, field: 'employee.companyText', kind: 'conflict',
  message: '所属公司资料不一致', reason: '原资料包含多个公司名称，需 HR 核实实际签约主体。',
  source: { sheetName: '合成来源表', rowNumber: 2, cell: 'D2', value: '合成公司甲 / 合成公司乙' },
  current: { value: '当前确认的合成公司' }, status: 'open', canConfirmCurrent: true, fingerprint: 'version-one',
  maintenance: { employeeId: employee.id, requestId: 'synthetic-request', draft: false },
};
const missing = {
  ...conflict, id: 'missing-status', field: 'employee.employeeStatus', kind: 'missing', message: '员工状态待核实',
  reason: '源资料未提供在离职状态，请核实后在原编辑流程填写。', source: { sheetName: '合成来源表', rowNumber: 2, value: null },
  current: { value: null }, canConfirmCurrent: false, confirmBlockedReason: '缺少状态，不能直接确认保留空值。',
};
const identity = {
  ...missing, id: 'identity-candidate', kind: 'identity', field: 'identity', message: '存在仅姓名匹配的候选档案',
  reason: '仅姓名相同不能确认是同一人，需要核实身份资料。', confirmBlockedReason: '请先核实身份，不能直接确认同名候选。',
};

async function setup(page: Page, options: { sourceDraft?: boolean; role?: string; capabilities?: string[] } = {}) {
  const state = { items: options.sourceDraft ? [
    { ...missing, employeeId: null, requestId: draft.id, maintenance: { requestId: draft.id, draft: true } },
    { ...identity, employeeId: null, requestId: draft.id, maintenance: { requestId: draft.id, draft: true } },
  ] : [conflict, missing], confirms: [] as Record<string, unknown>[], saves: [] as Record<string, any>[],
  failRead: false, failConfirm: 0, confirmDelay: 0, submitted: 0 };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'synthetic-hr'); localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 'synthetic-hr', name: '合成 HR', sysRole: options.role || 'hr_user', hrCapabilities: options.capabilities ?? ['employee_archive_edit', 'employee_archive_review'] };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/departments')) data = [{ id: 'synthetic-department', name: '合成部门', fullPath: '合成部门', company: 'fuede', children: [], isActive: true }];
    else if (path.endsWith('/users')) data = { items: [employee], total: 1, page: 1, pageSize: 20 };
    else if (path.includes('/employee-archives/issues/')) {
      if (request.method() === 'POST') {
        state.confirms.push(request.postDataJSON());
        if (state.confirmDelay) await new Promise(resolve => setTimeout(resolve, state.confirmDelay));
        if (state.failConfirm) { await route.fulfill({ status: state.failConfirm, json: { message: '资料已更新，请重新核对。' } }); return; }
        const issueId = path.split('/').at(-2);
        state.items = state.items.filter(item => item.id !== issueId);
        data = { confirmed: true, alreadyConfirmed: false, issueId };
      } else {
        if (state.failRead) { await route.fulfill({ status: 503, json: { message: '读取失败' } }); return; }
        data = { items: state.items };
      }
    } else if (path.endsWith('/employee-archives/drafts/list')) data = { items: options.sourceDraft ? [draft] : [], total: options.sourceDraft ? 1 : 0, page: 1, pageSize: 20 };
    else if (path.endsWith(`/employee-archives/applications/${draft.id}`)) data = draft;
    else if (path.endsWith('/employee-archives/drafts') && request.method() === 'POST') {
      const body = request.postDataJSON(); state.saves.push(body);
      data = { ...draft, proposedValue: { ...draft.proposedValue, employee: body.employee } };
    } else if (path.endsWith('/employee-archives') && request.method() === 'POST') { state.submitted++; data = {}; }
    else if (path.endsWith(`/employee-archives/${employee.id}`)) data = { ...employee, currentEmployment: {}, employeeProfile: {}, employmentHistory: [], employeeContracts: [], changeHistory: [], archiveEvents: [], dept: { name: '合成部门' }, dingtalkBinding: null };
    else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: response(data) });
  });
  return state;
}

for (const width of [1440, 1024, 390]) {
  test(`${width}px roster opens shared source/current/reason issues and confirms only allowed issues`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const state = await setup(page);
    await page.goto('/users');
    const list = page.locator(width < 768 ? '.roster-mobile-list' : '.desktop-result-table').filter({ visible: true });
    await list.getByRole('button', { name: '待确认 2项', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '档案待确认事项', exact: true });
    await expect(dialog.getByText('合成公司甲 / 合成公司乙', { exact: true })).toBeVisible();
    await expect(dialog.getByText('当前确认的合成公司', { exact: true })).toBeVisible();
    await expect(dialog.getByText(conflict.reason, { exact: true })).toBeVisible();
    await expect(dialog.getByText('合成来源表 · 第 2 行 · D2', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '确认以当前资料为准', exact: true })).toHaveCount(1);
    await expect(dialog.getByText(missing.confirmBlockedReason, { exact: true })).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');
    await expect(dialog.locator('..')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `../tmp/employee-archive-issues-20261030/issues-${width}.png`, fullPage: true });
    await dialog.getByRole('button', { name: '确认以当前资料为准', exact: true }).click();
    await expect.poll(() => state.confirms.length).toBe(1);
    expect(state.confirms[0]).toEqual({ fingerprint: 'version-one' });
    await expect(dialog.getByText(conflict.message, { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '确认以当前资料为准', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}

test('source draft keeps null status/type through edit and save; missing identity cannot be confirmed', async ({ page }) => {
  const state = await setup(page, { sourceDraft: true });
  await page.goto('/personnel-processing');
  await page.getByRole('tab', { name: '草稿', exact: true }).click();
  await page.getByRole('button', { name: '待确认 2项', exact: true }).filter({ visible: true }).click();
  const issues = page.getByRole('dialog', { name: '档案待确认事项', exact: true });
  await expect(issues.getByText(identity.reason, { exact: true })).toBeVisible();
  await expect(issues.getByRole('button', { name: '确认以当前资料为准', exact: true })).toHaveCount(0);
  await issues.getByRole('button', { name: '去核实资料', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '新增员工', exact: true });
  await expect(drawer).toBeVisible();
  for (const label of ['用工类型', '员工状态']) {
    const field = drawer.locator('.el-form-item').filter({ has: page.getByText(label, { exact: true }) });
    await expect(field.locator('.el-select__selected-item').filter({ hasText: /全职|试用期/ })).toHaveCount(0);
    await expect(field.locator('.el-form-item__error')).toContainText('待核实');
  }
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await drawer.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: '提交前还需补充' })).toContainText('用工类型、员工状态');
  await expect(drawer.getByRole('alert').filter({ hasText: '提交前还需补充' })).toContainText('组织归属');
  expect(state.submitted).toBe(0);
  await drawer.getByRole('button', { name: '保存并退出', exact: true }).click();
  await expect.poll(() => state.saves.length).toBeGreaterThan(0);
  for (const body of state.saves) {
    expect(body.employeeStatus).toBeNull(); expect(body.employmentType).toBeNull();
    expect(body.employee.employeeStatus).toBeNull(); expect(body.employee.employmentType).toBeNull();
    expect(body.company).toBeNull(); expect(body.employee.company).toBeNull();
    expect(body.employee.probationMonths).toBeNull();
  }
  expect(state.submitted).toBe(0);
  expect(state.confirms).toHaveLength(0);
});

test('blank new employee preserves the existing probation/full-time defaults', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/personnel-processing');
  await page.getByRole('button', { name: '新增员工', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增员工', exact: true });
  await drawer.locator('.el-form-item').filter({ has: page.getByText('姓名', { exact: true }) }).getByRole('textbox').fill('合成新建');
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect.poll(() => state.saves.length).toBeGreaterThan(0);
  expect(state.saves.at(-1)?.employeeStatus).toBe('probation');
  expect(state.saves.at(-1)?.employmentType).toBe('full_time');
});

test('stale confirmation refreshes values and requires another explicit review', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/users');
  await page.getByRole('button', { name: '待确认 2项', exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole('dialog', { name: '档案待确认事项', exact: true });
  await expect(dialog.getByText('当前确认的合成公司', { exact: true })).toBeVisible();
  state.items = state.items.map(item => item.id === conflict.id ? { ...item, fingerprint: 'version-two', current: { value: '其他 HR 已核实的新值' } } : item);
  state.failConfirm = 409;
  await dialog.getByRole('button', { name: '确认以当前资料为准', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('资料已更新');
  await expect(dialog.getByText('其他 HR 已核实的新值', { exact: true })).toBeVisible();
  expect(state.confirms).toEqual([{ fingerprint: 'version-one' }]);
  state.failConfirm = 0;
  await dialog.getByRole('button', { name: '确认以当前资料为准', exact: true }).click();
  await expect.poll(() => state.confirms.length).toBe(2);
  expect(state.confirms[1]).toEqual({ fingerprint: 'version-two' });
});

test('read and confirm failures are retryable; an in-flight confirmation cannot be closed or duplicated', async ({ page }) => {
  const state = await setup(page);
  state.failRead = true;
  await page.goto('/users');
  await page.getByRole('button', { name: '待确认 2项', exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole('dialog', { name: '档案待确认事项', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('读取失败');
  state.failRead = false;
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(dialog.getByText(conflict.message, { exact: true })).toBeVisible();
  state.failConfirm = 503;
  await dialog.getByRole('button', { name: '确认以当前资料为准', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('确认未完成');
  await expect(dialog.getByText(conflict.message, { exact: true })).toBeVisible();
  state.failConfirm = 0; state.confirmDelay = 500;
  await dialog.getByRole('button', { name: '确认以当前资料为准', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '确认以当前资料为准', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(conflict.message, { exact: true })).toHaveCount(0);
  expect(state.confirms).toHaveLength(2);
});

test('employee capability spoofing does not reveal archive issue entry', async ({ page }) => {
  await setup(page, { role: 'employee' });
  await page.goto('/users');
  await expect(page.getByRole('button', { name: '待确认 2项', exact: true })).toHaveCount(0);
});

test('review-only HR can inspect issues without a confirmation write entry', async ({ page }) => {
  await setup(page, { capabilities: ['employee_archive_review'] });
  await page.goto('/users');
  await page.getByRole('button', { name: '待确认 2项', exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole('dialog', { name: '档案待确认事项', exact: true });
  await expect(dialog.getByText(conflict.reason, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '确认以当前资料为准', exact: true })).toHaveCount(0);
});

test('review-only draft issue opens existing read-only application without autosaving a draft', async ({ page }) => {
  const state = await setup(page, { sourceDraft: true, capabilities: ['employee_archive_review'] });
  await page.goto('/users');
  await page.getByRole('button', { name: '待确认 2项', exact: true }).filter({ visible: true }).click();
  const issues = page.getByRole('dialog', { name: '档案待确认事项', exact: true });
  await issues.getByRole('button', { name: '查看资料', exact: true }).first().click();
  const details = page.getByRole('dialog', { name: '新增员工办理详情', exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByText(draft.employeeName, { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '新增员工', exact: true })).toHaveCount(0);
  await expect(details.getByRole('button', { name: '保存并退出', exact: true })).toHaveCount(0);
  await details.getByRole('button', { name: '关闭', exact: true }).click();
  expect(state.saves).toHaveLength(0);
  expect(state.submitted).toBe(0);
});

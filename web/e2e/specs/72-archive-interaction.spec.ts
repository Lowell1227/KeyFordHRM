import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, options: { issueField?: string; issueDraft?: boolean } = {}) {
  const people = ['甲', '乙'].map((name, i) => ({ id: `person-${i}`, name: `合成员工${name}`, employeeNo: `UX00${i}`,
    deptId: 'dept-1', deptName: '合成部门', sysRole: 'employee', status: 'active', employmentType: 'full_time',
    hrCapabilities: [], businessIdentities: [], position: '合成岗位', archivedAt: null, archiveIssueCount: 1 }));
  const state = { saves: [] as any[], submits: [] as any[], conflict: false, delay: 0, version: 0, saved: null as any };
  await page.addInitScript(() => { localStorage.setItem('token', 'SYNTHETIC-UX-ONLY'); localStorage.setItem('expiresAt', String(Date.now() + 600_000)); });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let data: any = [];
    if (path.endsWith('/auth/me')) data = { id: 'hr-1', name: '合成HR', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/departments')) data = [{ id: 'dept-1', name: '合成部门', company: 'fuede', children: [] }];
    else if (path.endsWith('/users')) data = { items: people, total: people.length, page: 1, pageSize: 20 };
    else if (path.includes('/employee-archives/issues/')) data = { items: [{ id: 'issue-location', requestId: 'source-1', employeeId: options.issueDraft ? null : 'person-0',
      field: options.issueField ?? 'employee.workLocation', kind: 'missing', message: '合成资料待补充', reason: '原表未填写，请HR核实',
      source: { sheetName: '合成来源', rowNumber: 3, value: null }, current: { value: null }, status: 'open',
      canConfirmCurrent: false, fingerprint: 'synthetic', maintenance: { employeeId: options.issueDraft ? undefined : 'person-0', requestId: 'source-1', draft: Boolean(options.issueDraft) } }] };
    else if (path.endsWith('/employee-archives/drafts/list') && options.issueDraft) data = { items: [{
      id: 'source-1', userId: null, employeeName: '合成待核资料', sourceType: 'manual_employee_create',
      sourceSystem: 'roster_reconcile_20261030', recordStatus: 'draft', requestVersion: 1, archivedAt: null,
      archiveIssueCount: 1, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
      validationErrors: [], validationWarnings: [], baseValue: {}, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
      proposedValue: { employee: { name: '合成待核资料', company: 'fuede', deptId: 'dept-1', entryDate: '2026-01-01',
        effectiveFrom: '2026-01-01', employeeStatus: null, employmentType: null }, profile: {}, contracts: [], performance: {} },
    }], total: 1, page: 1, pageSize: 20 };
    else if (/\/employee-archives\/person-\d\/(draft|draft\/save)$/.test(path)) {
      const body = request.postDataJSON();
      const save = path.endsWith('/save');
      (save ? state.saves : state.submits).push(body);
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      if (state.conflict) { await route.fulfill({ status: 409, json: { code: 409, message: '资料已更新，请重新核对' } }); return; }
      data = { id: 'draft-1', userId: path.split('/').at(-3), requestVersion: ++state.version, recordStatus: save ? 'draft' : 'submitted',
        sourceType: 'manual_archive_change', baseValue: {}, proposedValue: body, employeeName: '合成员工甲',
        profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', validationErrors: [] };
      state.saved = data;
    } else if (/\/employee-archives\/person-\d$/.test(path)) {
      const person = people.find(person => path.endsWith(person.id))!;
      const employment = { id: 'employment-1', company: 'fuede', workLocation: null, deptId: 'dept-1', employeeStatus: 'active', employmentType: 'full_time' };
      data = { ...person, archiveVersion: 'synthetic-archive-version', currentEmployment: employment, employmentHistory: [employment], employeeProfile: {},
        employeeContracts: [], changeHistory: state.saved && path.endsWith('person-0') ? [state.saved] : [], dept: { id: 'dept-1', name: '合成部门' } };
    } else if (path.includes('/personnel-reference-data/')) data = [{ id: 'location-1', kind: 'work_location', name: '合成办公地', isActive: true }];
    else if (path.includes('/applications/draft-1')) data = state.saved;
    else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: { code: 0, message: 'success', data } });
  });
  return state;
}

for (const [field, targetField] of [['employeeStatus', 'employee.employeeStatus'], ['employmentType', 'employee.employmentType'],
  ['company', 'employee.companyText'], ['employee.contractSubjectId', 'employee.companyText']]) {
  test(`真实待核草稿字段形态 ${field} 定位对应任职字段`, async ({ page }) => {
    await setup(page, { issueField: field, issueDraft: true });
    await page.goto('/personnel-processing');
    await page.getByRole('tab', { name: '草稿', exact: true }).click();
    await page.getByRole('button', { name: '待确认 1项', exact: true }).filter({ visible: true }).click();
    await page.getByRole('dialog', { name: '档案待确认事项' }).getByRole('button', { name: '去核实资料', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '新增员工', exact: true });
    const target = drawer.locator(`[data-archive-field="${targetField}"]`);
    await expect(target).toHaveClass(/archive-field--focused/);
    await expect(target.locator('input')).toBeFocused();
  });
}

async function openEditor(page: Page) {
  await page.goto('/users');
  await page.getByRole('button', { name: '查看档案', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
  return drawer;
}

test('尚未填写姓名的修改离开时可以继续填写，不丢失输入', async ({ page }) => {
  await setup(page); await page.goto('/personnel-processing');
  await page.getByRole('button', { name: '新增员工', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增员工', exact: true });
  await drawer.getByRole('textbox', { name: '手机号', exact: true }).fill('合成待补信息');
  await drawer.locator('.el-drawer__close-btn').click();
  const confirm = page.getByRole('dialog', { name: '未保存的内容', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '继续填写', exact: true }).click();
  await expect(drawer.getByRole('textbox', { name: '手机号', exact: true })).toHaveValue('合成待补信息');
});

test('旧草稿加载晚返回不会覆盖后来打开的另一份档案', async ({ page }) => {
  await setup(page);
  let releaseFirst: (() => void) | undefined;
  const drafts = [0, 1].map(index => ({ id: `draft-${index}`, userId: `person-${index}`, employeeName: `合成草稿${index}`,
    sourceType: 'manual_archive_change', recordStatus: 'draft', requestVersion: 1, profileReviewStatus: 'pending',
    performanceReviewStatus: 'not_required', baseValue: {}, proposedValue: {}, validationErrors: [], createdAt: '2026-01-01T00:00:00Z' }));
  await page.route('**/api/v1/employee-archives/drafts/list*', route => route.fulfill({ json: { code: 0, data: { items: drafts, total: 2, page: 1, pageSize: 20 } } }));
  await page.route('**/api/v1/employee-archives/person-0', async route => {
    await new Promise<void>(resolve => { releaseFirst = resolve; });
    await route.fulfill({ json: { code: 0, data: { id: 'person-0', name: '合成员工甲', employeeNo: 'UX000', status: 'active',
      archiveVersion: 'first', currentEmployment: {}, employeeProfile: {}, employmentHistory: [], employeeContracts: [], changeHistory: [] } } });
  });
  await page.goto('/personnel-processing'); await page.getByRole('tab', { name: '草稿', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await expect.poll(() => Boolean(releaseFirst)).toBeTruthy();
  await drawer.locator('.el-drawer__close-btn').click(); await expect(drawer).not.toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).nth(1).click();
  await expect(drawer.getByRole('heading', { name: '合成员工乙', exact: true })).toBeVisible();
  releaseFirst?.();
  await page.waitForTimeout(300);
  await expect(drawer.getByRole('heading', { name: '合成员工乙', exact: true })).toBeVisible();
});

for (const width of [1440, 1024, 390]) {
  test(`${width}px 待确认事项定位字段并保留核对上下文`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await setup(page); await page.goto('/users');
    await page.getByRole('button', { name: '待确认 1项', exact: true }).first().click();
    await page.getByRole('dialog', { name: '档案待确认事项' }).getByRole('button', { name: '去核实资料', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
    await expect(drawer.getByRole('note', { name: '正在核实事项' })).toContainText('原表未填写');
    await expect(drawer.locator('[data-archive-field="employee.workLocation"]')).toHaveClass(/archive-field--focused/);
    await expect(drawer.locator('[data-archive-field="employee.workLocation"] input')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`issue-${width}.png`), fullPage: true });
  });
}

test('自动保存后保留编辑且携带服务端版本，提交不跳离原列表', async ({ page }) => {
  const state = await setup(page), drawer = await openEditor(page);
  const grade = drawer.locator('.el-form-item').filter({ has: page.getByText('职级', { exact: true }) }).getByRole('textbox');
  await grade.fill('合成职级一');
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].baseVersion).toBe('synthetic-archive-version');
  await expect(drawer.getByRole('status')).toContainText('草稿已保存');
  await expect(grade).toHaveValue('合成职级一');
  await grade.fill('合成职级二');
  await expect.poll(() => state.saves.length).toBe(2);
  expect(state.saves[1].draftId).toBe('draft-1'); expect(state.saves[1].expectedVersion).toBe(1);
  await drawer.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect.poll(() => state.submits.length).toBe(1);
  expect(state.submits[0].expectedVersion).toBe(2);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('已提交审核，审核通过后生效', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '下一位待处理', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: '合成员工乙', exact: true })).toBeVisible();
});

test('保存冲突保留输入和错误说明，停止自动覆盖', async ({ page }) => {
  const state = await setup(page); state.conflict = true;
  const drawer = await openEditor(page), grade = drawer.locator('.el-form-item').filter({ has: page.getByText('职级', { exact: true }) }).getByRole('textbox');
  await grade.fill('冲突仍保留');
  await expect(drawer.getByRole('alert').filter({ hasText: '资料已更新' })).toBeVisible();
  await expect(grade).toHaveValue('冲突仍保留');
  await grade.fill('继续输入也保留');
  await page.waitForTimeout(1100);
  expect(state.saves).toHaveLength(1);
  await expect(grade).toHaveValue('继续输入也保留');
});

test('保存中关闭受保护，晚到响应不改下一位档案', async ({ page }) => {
  const state = await setup(page); state.delay = 1000;
  const drawer = await openEditor(page), grade = drawer.locator('.el-form-item').filter({ has: page.getByText('职级', { exact: true }) }).getByRole('textbox');
  await grade.fill('保存期间输入');
  await expect.poll(() => state.saves.length).toBe(1);
  await drawer.locator('.el-drawer__close-btn').click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('status')).toContainText('草稿已保存');
  await expect(grade).toHaveValue('保存期间输入');
});

test('新建草稿保存期间打开匹配档案会先保留草稿', async ({ page }) => {
  await setup(page);
  let saves = 0, finishSave: (() => void) | undefined;
  await page.route('**/api/v1/employee-archives/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/identity-lookup')) {
      await route.fulfill({ json: { code: 0, data: { outcome: 'phone_candidates', candidates: [{ id: 'person-1', maskedName: '合*乙', currentEmployeeNo: 'UX001', status: 'active', matchBasis: 'phone', nextAction: 'view_profile' }] } } });
    } else if (path.endsWith('/drafts') && route.request().method() === 'POST') {
      saves++; await new Promise<void>(resolve => { finishSave = resolve; });
      await route.fulfill({ json: { code: 0, data: { id: 'new-draft', requestVersion: saves, recordStatus: 'draft' } } });
    } else await route.fallback();
  });
  await page.goto('/personnel-processing'); await page.getByRole('button', { name: '新增员工', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增员工', exact: true });
  await drawer.getByRole('textbox', { name: '姓名', exact: true }).fill('合成新资料');
  await drawer.getByRole('textbox', { name: '手机号', exact: true }).fill('13800000000');
  await drawer.getByRole('textbox', { name: '姓名', exact: true }).click();
  await expect.poll(() => saves).toBe(1);
  await drawer.getByRole('button', { name: '打开现有档案', exact: true }).click();
  // The save is deliberately held; opening another record must wait for it.
  await page.waitForTimeout(500);
  await expect(drawer).toBeVisible();
  finishSave?.();
  await expect(drawer).not.toBeVisible();
});

test('档案慢响应期间的新输入与自动保存等待者只顺序保存一次新版本', async ({ page }) => {
  await setup(page);
  const bodies: any[] = [];
  let active = 0, maximumActive = 0, version = 0, releaseFirst: (() => void) | undefined;
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  await page.route('**/api/v1/employee-archives/person-0/draft/save', async route => {
    const body = route.request().postDataJSON(), index = bodies.length;
    bodies.push(body); active++; maximumActive = Math.max(maximumActive, active);
    if (index === 0) await firstResponse;
    await new Promise(resolve => setTimeout(resolve, 100));
    active--;
    await route.fulfill({ json: { code: 0, data: { id: 'draft-1', userId: 'person-0', requestVersion: ++version,
      sourceType: 'manual_archive_change', recordStatus: 'draft', proposedValue: body } } });
  });
  const drawer = await openEditor(page);
  const grade = drawer.locator('[data-archive-field="employee.jobGrade"] input');
  await grade.fill('慢保存第一版');
  await expect.poll(() => bodies.length).toBe(1);
  await grade.fill('慢保存期间第二版');
  // Let the second debounce callback wait on the deliberately held first save.
  await page.waitForTimeout(850);
  releaseFirst?.();
  await expect.poll(() => bodies.length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => active).toBe(0);
  expect(maximumActive).toBe(1);
  expect(bodies).toHaveLength(2);
  expect(bodies.map(body => body.expectedVersion)).toEqual([undefined, 1]);
  expect(bodies[1].employee.jobGrade).toBe('慢保存期间第二版');
  await expect(drawer.getByRole('status')).toContainText('草稿已保存');
});

test('新增草稿慢响应期间的新输入与手动保存等待者不并行覆盖同一版本', async ({ page }) => {
  await setup(page);
  const bodies: any[] = [];
  let active = 0, maximumActive = 0, version = 0, releaseFirst: (() => void) | undefined;
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  await page.route('**/api/v1/employee-archives/drafts', async route => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    const body = route.request().postDataJSON(), index = bodies.length;
    bodies.push(body); active++; maximumActive = Math.max(maximumActive, active);
    if (index === 0) await firstResponse;
    await new Promise(resolve => setTimeout(resolve, 100));
    active--;
    await route.fulfill({ json: { code: 0, data: { id: 'new-draft', requestVersion: ++version, recordStatus: 'draft' } } });
  });
  await page.goto('/personnel-processing');
  await page.getByRole('button', { name: '新增员工', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增员工', exact: true });
  await drawer.getByRole('textbox', { name: '姓名', exact: true }).fill('慢保存第一版');
  await expect.poll(() => bodies.length).toBe(1);
  await drawer.getByRole('textbox', { name: '姓名', exact: true }).fill('慢保存期间第二版');
  await drawer.getByRole('button', { name: '保存并退出', exact: true }).click();
  releaseFirst?.();
  await expect.poll(() => bodies.length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => active).toBe(0);
  expect(maximumActive).toBe(1);
  expect(bodies).toHaveLength(2);
  expect(bodies.map(body => body.expectedVersion)).toEqual([undefined, 1]);
  expect(bodies[1].name).toBe('慢保存期间第二版');
  await expect(drawer).not.toBeVisible();
});

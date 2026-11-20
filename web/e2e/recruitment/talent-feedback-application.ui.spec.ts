import { test, expect, type Page } from '@playwright/test';

// Synthetic API responses isolate the panel; these are not business acceptance tests.
const candidate = { id: 'feedback-candidate', editVersion: 'v1', name: '虚构部门回归人才', status: 'new', sourceChannel: 'referral', gender: 'unknown', tags: [], files: [], followUps: [], shares: [], updatedAt: '2026-11-20T00:00:00Z' };
const application = { id: 'feedback-application', candidateId: candidate.id, positionName: '虚构工程师', recruitmentBatch: '虚构批次', deptId: 'active-dept', departmentNameSnapshot: '有效虚构部门', ownerId: 'handler', ownerName: '虚构经办', stage: 'screening', revision: 3, expectedEntryDate: null, allowedActions: ['submit_hiring', 'withdraw'], events: [], onboardingRequest: null, hiringRequestedById: 'handler' };
const departments = [
  { id: 'active-dept', name: '有效虚构部门', isActive: true },
  { id: 'inactive-dept', name: '停用虚构部门', isActive: false },
  { id: 'inactive-parent', name: '停用父部门', isActive: false, children: [{ id: 'active-child', name: '有效子部门', isActive: true }] },
];
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
type Application = Omit<typeof application, 'deptId' | 'events'> & { deptId: string | null; events: Array<{ id: string; action: string; toStage: string; createdAt: string; reserveReasons?: string[]; note?: string | null }> };

async function install(page: Page, options: { current?: Application; history?: Application; role?: string; capabilities?: string[]; userId?: string } = {}) {
  let current = options.current ?? { ...application };
  const writes: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => { localStorage.setItem('token', 'mock-talent-feedback'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(envelope({ id: options.userId ?? 'handler', name: '虚构使用者', sysRole: options.role ?? 'hr', canViewAll: false, hrCapabilities: options.capabilities ?? [], businessCapabilities: {} }));
    if (path.endsWith('/notifications/unread-count')) return route.fulfill(envelope({ count: 0 }));
    if (path.endsWith('/talents')) return route.fulfill(envelope({ items: [{ ...candidate, latestApplication: current }], total: 1 }));
    if (path.endsWith(`/talents/${candidate.id}`)) return route.fulfill(envelope(candidate));
    if (path.includes('/candidates/') && path.endsWith('/applications')) return route.fulfill(envelope([current, ...(options.history ? [options.history] : [])]));
    if (path.endsWith(`/applications/${current.id}`)) {
      if (request.method() === 'PATCH') { const body = request.postDataJSON(); writes.push(body); current = { ...current, ...body, revision: current.revision + 1 }; }
      return route.fulfill(envelope(current));
    }
    if (options.history && path.endsWith(`/applications/${options.history.id}`)) return route.fulfill(envelope(options.history));
    if (path.endsWith('/actions')) {
      const body = request.postDataJSON(); writes.push(body);
      if (body.action === 'accept_offer') current = { ...current, stage: 'accepted', allowedActions: ['withdraw'], revision: current.revision + 1 };
      return route.fulfill(envelope(current));
    }
    if (path.endsWith('/owners')) return route.fulfill(envelope({ items: [{ id: 'handler', name: '虚构经办', employeeNo: 'MOCK', deptName: '虚构人事部' }], total: 1 }));
    if (path.endsWith('/departments')) return route.fulfill(envelope(departments));
    if (path.endsWith('/talent-interviews') || path.endsWith('/follow-ups') || path.endsWith('/hiring-reviews')) return route.fulfill(envelope([]));
    return route.fulfill(envelope(null));
  });
  return { writes };
}

async function openPanel(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/talents');
  if (width <= 768) await page.getByRole('button', { name: '打开详情', exact: true }).click();
  else await page.getByText(candidate.name, { exact: true }).first().click();
  const panel = page.locator('.application-panel');
  await expect(panel.getByRole('heading', { name: '应聘记录' })).toBeVisible();
  return panel;
}

for (const width of [1440, 390]) {
  test(`only active departments are selectable and clearing remains optional at ${width}px (mock)`, async ({ page }, testInfo) => {
    const { writes } = await install(page);
    const panel = await openPanel(page, width);
    await panel.getByRole('button', { name: '修改应聘', exact: true }).click();
    const field = panel.locator('.el-form-item').filter({ hasText: '部门（选填）' });
    await field.getByRole('combobox').press('ArrowDown');
    await expect(page.getByRole('option', { name: '停用虚构部门', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: '停用父部门', exact: true })).toHaveCount(0);
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('department-options.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('option', { name: '停用父部门 / 有效子部门', exact: true }).click();
    await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ deptId: 'active-child', expectedRevision: 3 });
    await panel.getByRole('button', { name: '修改应聘', exact: true }).click();
    await field.hover();
    await field.locator('.el-select__clear').click();
    await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toMatchObject({ deptId: null, expectedRevision: 4 });
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const deptId of ['inactive-dept', 'missing-dept']) {
  test(`historical ${deptId} stays visible and rejected saves identify the department field (mock)`, async ({ page }) => {
    const current = { ...application, deptId, departmentNameSnapshot: '历史虚构部门' };
    await install(page, { current });
    const rejected: Array<Record<string, unknown>> = [];
    await page.route(`**/api/v1/talent-recruitment/applications/${current.id}`, route => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      rejected.push(route.request().postDataJSON());
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: ['请选择有效的应聘部门'] }) });
    });
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: '修改应聘', exact: true }).click();
    const field = panel.locator('.el-form-item').filter({ hasText: '部门（选填）' });
    await expect(field).toContainText('历史虚构部门（已停用或不可用）');
    await field.getByRole('combobox').press('ArrowDown');
    await expect(page.getByRole('option', { name: '历史虚构部门（已停用或不可用）', exact: true })).toBeDisabled();
    await field.getByRole('combobox').press('Escape');
    await panel.getByLabel('岗位名称').fill('保留修改中的虚构岗位');
    await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
    await expect(field.locator('.el-form-item__error')).toHaveText('请选择有效的应聘部门');
    expect(rejected[0]).toMatchObject({ deptId, positionName: '保留修改中的虚构岗位' });
    await expect(panel.getByLabel('岗位名称')).toHaveValue('保留修改中的虚构岗位');
    await field.hover(); await field.locator('.el-select__clear').click();
    await expect(field.locator('.el-form-item__error')).toHaveCount(0);
  });
}

test('a department invalidated after options load shows the server rejection beside that field (mock)', async ({ page }) => {
  await install(page);
  await page.route(`**/api/v1/talent-recruitment/applications/${application.id}`, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '请选择有效的应聘部门' }) })
    : route.fallback());
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: '修改应聘', exact: true }).click();
  await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
  await expect(panel.locator('.el-form-item').filter({ hasText: '部门（选填）' }).locator('.el-form-item__error')).toHaveText('请选择有效的应聘部门');
});

for (const width of [1440, 390]) {
  test(`hiring submitter gets independent-review guidance without a self-review action at ${width}px (mock)`, async ({ page }, testInfo) => {
    const current = { ...application, stage: 'hiring_review', allowedActions: ['withdraw'] };
    await install(page, { current });
    const panel = await openPanel(page, width);
    await expect(panel).toContainText('人员 → 录用确认');
    await expect(panel).toContainText('提交人不能确认本人提交的申请');
    await expect(panel.getByRole('button', { name: '前往录用确认', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '确认录用', exact: true })).toHaveCount(0);
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('hiring-guidance.png'), fullPage: true, animations: 'disabled' });
  });
}

test('a qualified independent reviewer can open the existing hiring route (mock)', async ({ page }) => {
  await install(page, { userId: 'reviewer', role: 'hr_user', capabilities: ['employee_archive_review', 'talent_hiring_confirm'], current: { ...application, stage: 'hiring_review', allowedActions: ['approve_hiring', 'return_hiring'] } });
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: '前往录用确认', exact: true }).click();
  await expect(page).toHaveURL(/\/talent-hiring$/);
});

test('record actions cannot offer the hiring route without its existing capability (mock)', async ({ page }) => {
  await install(page, { userId: 'reviewer', role: 'system_admin', current: { ...application, stage: 'hiring_review', allowedActions: ['approve_hiring'] } });
  const panel = await openPanel(page);
  await expect(panel).toContainText('人员 → 录用确认');
  await expect(panel.getByRole('button', { name: '前往录用确认', exact: true })).toHaveCount(0);
});

test('offered guidance preserves the selected application and acceptance opens onboarding (mock)', async ({ page }) => {
  const history = { ...application, id: 'history-application', positionName: '历史虚构岗位', stage: 'rejected', allowedActions: ['reopen'] };
  await install(page, { current: { ...application, stage: 'offered', allowedActions: ['accept_offer', 'decline_offer'] }, history });
  const panel = await openPanel(page, 390);
  const selector = panel.getByRole('combobox', { name: '选择应聘记录' });
  await selector.press('ArrowDown'); await page.getByRole('option', { name: /历史虚构岗位/ }).click();
  await expect(panel.getByRole('button', { name: '重开应聘', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '刷新应聘记录' }).click();
  await expect(panel.getByRole('button', { name: '重开应聘', exact: true })).toBeVisible();
  await expect(panel.getByText(/下一步.*候选人/)).toHaveCount(0);
  await selector.press('ArrowDown'); await page.getByRole('option', { name: /虚构工程师/ }).click();
  await expect(panel).toContainText('经办记录候选人接受或拒绝');
  await panel.getByRole('button', { name: '候选人接受', exact: true }).click();
  await panel.locator('.application-panel__command').getByRole('button', { name: '候选人接受', exact: true }).click();
  await panel.getByRole('button', { name: '办理入职', exact: true }).click();
  await expect(page).toHaveURL(/\/entry-exit\?talentId=feedback-candidate&talentApplicationId=feedback-application$/);
});

for (const width of [1440, 390]) {
  test(`reserve reasons support multiple choices and appear on their timeline event at ${width}px (mock)`, async ({ page }, testInfo) => {
    const current = { ...application, allowedActions: ['reserve'] };
    const { writes } = await install(page, { current });
    await page.route('**/api/v1/talent-recruitment/applications/*/actions', async route => {
      const body = route.request().postDataJSON(); writes.push(body);
      return route.fulfill(envelope({ ...current, stage: 'reserve', revision: 4, allowedActions: [], events: [
        { id: 'reserve-event', action: 'reserve', toStage: 'reserve', createdAt: '2026-11-20T00:00:00Z', reserveReasons: body.reserveReasons, note: body.note ?? null },
      ] }));
    });
    const panel = await openPanel(page, width);
    await panel.getByRole('button', { name: '转储备', exact: true }).click();
    const command = panel.locator('.application-panel__command');
    await expect(command.getByText('通勤距离', { exact: true })).toBeVisible();
    await command.getByText('通勤距离', { exact: true }).click();
    await command.getByText('薪资期望', { exact: true }).click();
    await expect(command.getByRole('checkbox', { name: '工作制偏好', exact: true })).not.toBeChecked();
    await expect(command.getByText('其他', { exact: true })).toBeVisible();
    await command.getByRole('button', { name: '转储备', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ expectedRevision: 3, action: 'reserve', reserveReasons: ['commute_distance', 'salary_expectation'] });
    expect(writes[0]).not.toHaveProperty('note');
    await expect(panel.locator('.application-panel__event-reasons')).toContainText('通勤距离、薪资期望');
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('reserve-reasons.png'), fullPage: true, animations: 'disabled' });
  });
}

test('reserve reasons and the optional note survive a revision conflict and explicit refresh (mock)', async ({ page }) => {
  const current = { ...application, allowedActions: ['reserve'] };
  await install(page, { current });
  let attempts = 0;
  await page.route(`**/api/v1/talent-recruitment/applications/${current.id}`, route => route.fulfill(envelope({ ...current, revision: 4 })));
  await page.route('**/api/v1/talent-recruitment/applications/*/actions', route => {
    const body = route.request().postDataJSON();
    if (++attempts === 1) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '版本冲突' }) });
    expect(body).toMatchObject({ expectedRevision: 4, reserveReasons: ['other'], note: '保留中的储备说明' });
    return route.fulfill(envelope({ ...current, stage: 'reserve', revision: 5, allowedActions: [], events: [] }));
  });
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: '转储备', exact: true }).click();
  const command = panel.locator('.application-panel__command');
  await expect(command.getByText('其他', { exact: true })).toBeVisible();
  await command.getByText('其他', { exact: true }).click();
  await command.getByLabel('说明（选填）').fill('保留中的储备说明');
  await command.getByRole('button', { name: '转储备', exact: true }).click();
  await panel.getByRole('button', { name: '刷新记录，保留输入', exact: true }).click();
  await expect(command.getByRole('checkbox', { name: '其他', exact: true })).toBeChecked();
  await expect(command.getByLabel('说明（选填）')).toHaveValue('保留中的储备说明');
  await command.getByRole('button', { name: '转储备', exact: true }).click();
  await expect(panel.locator('.application-panel__stage')).toHaveText('人才储备');
});

test('reserve reasons remain optional and historical notes do not create inferred tags (mock)', async ({ page }) => {
  const current = { ...application, allowedActions: ['reserve'], events: [
    { id: 'historic-reserve', action: 'reserve', toStage: 'reserve', createdAt: '2026-10-01T00:00:00Z', note: '旧说明可能提及通勤，不能自动变成原因标签' },
  ] };
  const { writes } = await install(page, { current });
  const panel = await openPanel(page);
  await expect(panel.locator('.application-panel__event-reasons')).toHaveCount(0);
  await panel.getByRole('button', { name: '转储备', exact: true }).click();
  const command = panel.locator('.application-panel__command');
  await expect(command.getByText('其他', { exact: true })).toBeVisible();
  await command.getByText('其他', { exact: true }).click();
  await command.getByRole('button', { name: '取消操作', exact: true }).click();
  await panel.getByRole('button', { name: '转储备', exact: true }).click();
  await expect(command.getByRole('checkbox', { name: '其他', exact: true })).not.toBeChecked();
  await command.getByRole('button', { name: '转储备', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ action: 'reserve', reserveReasons: [] });
});

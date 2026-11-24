import { test, expect, type Page } from '@playwright/test';

const demand = { id: 'demand-A', revision: 3, instanceId: 'FIC-DEMAND-2037-001', sourceState: 'approved',
  rawDepartment: '虚构研发中心 / 很长的招聘需求业务部门', rawPosition: '虚构测试工程师', rawHeadcount: '二位',
  deptId: 'dept-A', departmentName: '虚构研发中心 / 很长的招聘需求业务部门', positionId: 'job-A', positionName: '虚构测试工程师',
  approvedHeadcount: 2, usable: true, issues: [], approvedAt: '2037-01-01T00:00:00Z',
  sourceLink: 'https://aflow.dingtalk.com/fictional-instance', lastSyncedAt: '2037-01-02T00:00:00Z',
  events: [{ id: 'event-A', action: 'map', revision: 3, createdAt: '2037-01-02T00:00:00Z', actorName: '虚构经办', reason: '虚构原单和岗位目录已核对' }] };
const application = { id: 'app-A', candidateId: 'candidate-A', positionName: demand.positionName, deptId: demand.deptId,
  departmentNameSnapshot: demand.departmentName, ownerId: 'operator', ownerName: '虚构经办', recruitmentBatch: '虚构首批',
  stage: 'interviewing', revision: 6, allowedActions: ['submit_hiring'], events: [], onboardingRequest: null };
const candidate = { id: 'candidate-A', name: '虚构候选人', status: 'new', sourceChannel: 'referral', gender: 'unknown', tags: [],
  files: [], followUps: [], shares: [], updatedAt: '2037-01-01T00:00:00Z' };
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) });

async function install(page: Page, options: { viewer?: boolean; configured?: boolean; departmentMissing?: boolean; conflict?: boolean; listFailure?: boolean; partialSync?: boolean; recoverSync?: boolean } = {}) {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let revision = 3, failed = false, syncAttempts = 0;
  await page.addInitScript(() => { localStorage.setItem('token', 'fictional-local-ui-only'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1', '');
    if (!['GET', 'HEAD'].includes(request.method())) writes.push({ path, body: request.postDataJSON() });
    if (path === '/auth/me') return route.fulfill(envelope({ id: 'operator', name: '虚构经办', sysRole: 'employee',
      hrCapabilities: [options.viewer ? 'recruitment_view' : 'recruitment_edit'], businessCapabilities: {} }));
    if (path === '/notifications/unread-count') return route.fulfill(envelope({ count: 0 }));
    if (path === '/recruitment-demands/status') return route.fulfill(envelope({ configured: options.configured !== false, missing: options.configured === false ? ['processCode'] : [], readOnly: true }));
    if (path === '/recruitment-demands/directories') return route.fulfill(envelope({ departments: [{ id: 'dept-A', name: demand.departmentName }], positions: [{ id: 'job-A', code: 'FIC01', name: demand.positionName }] }));
    if (path === '/recruitment-demands/options') {
      expect(url.searchParams.get('applicationId')).toBe('app-A');
      return route.fulfill(envelope({ items: options.departmentMissing ? [] : [{ ...demand, revision }], total: options.departmentMissing ? 0 : 1 }));
    }
    if (path === '/recruitment-demands') {
      if (options.listFailure && !failed) { failed = true; return route.fulfill({ status: 503, ...envelope(null) }); }
      return route.fulfill(envelope({ items: [{ ...demand, revision }], total: 1 }));
    }
    if (path === '/recruitment-demands/demand-A/mapping') {
      revision++; return route.fulfill(envelope({ ...demand, revision }));
    }
    if (path === '/recruitment-demands/sync') {
      syncAttempts++;
      if (options.recoverSync && syncAttempts === 1) return route.abort('timedout');
      if (options.recoverSync && syncAttempts === 2) return route.fulfill(envelope({ synced: 500, failed: 0, remaining: 1, complete: false, cursor: 'next-cursor', limit: 500 }));
      return route.fulfill(envelope({ synced: 2, failed: options.partialSync ? 1 : 0, complete: !options.partialSync, remaining: 0, limit: 500, cursor: options.partialSync ? 'retry-cursor' : null }));
    }
    if (path === '/recruitment-demands/demand-A') return route.fulfill(envelope({ ...demand, revision }));
    if (path === '/talents') return route.fulfill(envelope({ items: [candidate], total: 1 }));
    if (path === '/talents/candidate-A') return route.fulfill(envelope(candidate));
    if (path === '/talent-recruitment/candidates/candidate-A/applications') return route.fulfill(envelope([{ ...application, deptId: options.departmentMissing ? null : 'dept-A' }]));
    if (path === '/talent-recruitment/applications/app-A') return route.fulfill(envelope({ ...application, revision: 7 }));
    if (path === '/talent-recruitment/applications/app-A/actions') {
      if (options.conflict) { revision = 4; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '招聘需求来源已变化，请刷新核对' }) }); }
      return route.fulfill(envelope({ ...application, stage: 'hiring_review', allowedActions: [] }));
    }
    if (path === '/departments') return route.fulfill(envelope([{ id: 'dept-A', name: demand.departmentName, isActive: true }]));
    if (path.endsWith('/owners')) return route.fulfill(envelope({ items: [], total: 0 }));
    if (path.endsWith('/follow-up-plans')) return route.fulfill(envelope([]));
    if (path.endsWith('/follow-ups') || path === '/talent-interviews' || path.endsWith('/application-positions')) return route.fulfill(envelope([]));
    return route.fulfill(envelope(null));
  });
  return writes;
}

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
  test(`demand list/detail/mapping fits ${width}px with separate approval and mapping`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const writes = await install(page);
    await page.goto('/recruitment/demands?candidateId=candidate-A&applicationId=app-A');
    await expect(page.getByTestId('business-list-page')).toBeVisible();
    await expect(page.getByRole('button', { name: '返回当前应聘', exact: true })).toBeVisible();
    const list = page.locator(width <= 768 ? '.mobile-result-list' : '.desktop-result-table');
    await expect(list).toContainText(demand.instanceId);
    await expect(list).toContainText('已核对，可供选用');
    await list.getByRole('button', { name: width <= 768 ? '查看需求' : '查看', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '招聘需求详情' });
    await expect(drawer).toContainText('钉钉审批'); await expect(drawer).toContainText('部门、岗位和人数核对');
    await expect(drawer.getByRole('link', { name: '查看钉钉原单' })).toHaveAttribute('href', demand.sourceLink);
    await drawer.getByRole('button', { name: '核对部门、岗位和人数' }).click();
    await drawer.getByRole('button', { name: '保存核对结果' }).click();
    await expect(drawer.getByText('请填写核对依据', { exact: true })).toBeVisible();
    await drawer.locator('textarea').fill('虚构原单及目录已逐项核对');
    await drawer.getByRole('button', { name: '保存核对结果' }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]?.body).toMatchObject({ expectedRevision: 3, deptId: 'dept-A', positionId: 'job-A', approvedHeadcount: 2 });
    await expect(drawer).toContainText('版本 4');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/recruitment-demand-web/detail-${width}.png`, fullPage: true });
  });
}

test('viewer can read but has no sync, map or source-refresh controls', async ({ page }) => {
  const writes = await install(page, { viewer: true });
  await page.goto('/recruitment/demands');
  await expect(page.getByRole('button', { name: '同步钉钉需求' })).toHaveCount(0);
  await page.locator('.desktop-result-table').getByRole('button', { name: '查看', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '招聘需求详情' });
  await expect(drawer.getByRole('button', { name: '核对部门、岗位和人数' })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: '刷新钉钉原单' })).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('unconfigured source is explicit and list failure offers retry, not false no-demand state', async ({ page }) => {
  await install(page, { configured: false, listFailure: true });
  await page.goto('/recruitment/demands');
  await expect(page.getByText('钉钉招聘需求接入未就绪', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '同步钉钉需求' })).toBeDisabled();
  await page.getByRole('button', { name: '重试列表', exact: true }).click();
  await expect(page.locator('.desktop-result-table')).toContainText(demand.instanceId);
});

for (const width of [1440, 390]) {
test(`hiring selector sends id/revision and conflict keeps opinion without retry at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const writes = await install(page, { conflict: true });
  await page.goto('/talents?candidateId=candidate-A&applicationId=app-A');
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '提交录用', exact: true }).click();
  const command = panel.locator('.application-panel__command');
  await command.locator('textarea').fill('需要完整保留的虚构录用意见');
  await command.getByRole('button', { name: '提交录用', exact: true }).click();
  await expect(command.getByText('请选择已批准且已核对的招聘需求单', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await command.getByRole('combobox', { name: '招聘需求单', exact: true }).press('ArrowDown');
  const dropdown = page.locator('.el-select__popper:visible').filter({ has: page.getByRole('option', { name: new RegExp(demand.instanceId) }) });
  await expect(dropdown).toBeVisible();
  expect(await dropdown.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1; })).toBe(true);
  await page.getByRole('option', { name: new RegExp(demand.instanceId) }).click();
  await command.getByRole('button', { name: '提交录用', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.body).toMatchObject({ recruitmentDemandId: demand.id, expectedDemandRevision: 3 });
  await expect(command.locator('textarea')).toHaveValue('需要完整保留的虚构录用意见');
  await expect(command).toContainText(demand.instanceId);
  await expect(command.getByRole('button', { name: '提交录用', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: '刷新记录，保留输入', exact: true }).click();
  await expect(command).toContainText('版本 4'); expect(writes).toHaveLength(1);
  const link = command.getByRole('link', { name: '前往招聘需求核对' });
  await expect(link).toHaveAttribute('href', '/recruitment/demands?candidateId=candidate-A&applicationId=app-A');
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
}

test('mobile sync dialog preserves dates and does not claim a partial sync completed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page, { partialSync: true });
  await page.goto('/recruitment/demands');
  await page.getByRole('button', { name: '同步钉钉需求' }).click();
  const dialog = page.getByRole('dialog', { name: '同步钉钉招聘需求', exact: true });
  await dialog.getByPlaceholder('开始日期', { exact: true }).fill('2037-01-01');
  await dialog.getByPlaceholder('结束日期', { exact: true }).fill('2037-01-31');
  await dialog.getByPlaceholder('结束日期', { exact: true }).press('Tab');
  await dialog.getByRole('button', { name: '开始同步', exact: true }).click();
  await expect(dialog.getByText(/同步未完成：已读取 2 单，失败 1 单/)).toBeVisible();
  await expect(dialog.getByPlaceholder('开始日期', { exact: true })).toHaveValue('2037-01-01');
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('sync response loss survives refresh and continues only on explicit stable-intent buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await install(page, { recoverSync: true });
  await page.goto('/recruitment/demands');
  await page.getByRole('button', { name: '同步钉钉需求', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '同步钉钉招聘需求', exact: true });
  await dialog.getByPlaceholder('开始日期', { exact: true }).fill('2037-01-01');
  await dialog.getByPlaceholder('结束日期', { exact: true }).fill('2037-01-31');
  await dialog.getByPlaceholder('结束日期', { exact: true }).press('Tab');
  await dialog.getByRole('button', { name: '开始同步', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '恢复本次', exact: true })).toBeVisible();
  await expect(dialog).toContainText('本次批次已保留');
  expect(writes).toHaveLength(1);
  const initial = writes[0]!.body;
  expect(initial.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  await page.reload();
  await page.getByRole('button', { name: '恢复本次同步', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '同步钉钉招聘需求', exact: true });
  await expect(dialog.getByPlaceholder('开始日期', { exact: true })).toHaveValue('2037-01-01');
  await expect(dialog.getByPlaceholder('开始日期', { exact: true })).toBeDisabled();
  expect(writes).toHaveLength(1);
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('recruitment-demand-sync:operator')))!);
  expect(Object.keys(saved).sort()).toEqual(['cursor', 'from', 'requestId', 'to']);
  await dialog.getByRole('button', { name: '恢复本次', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '继续同步', exact: true })).toBeVisible();
  expect(writes).toHaveLength(2); expect(writes[1]!.body).toEqual(initial);
  await expect(page.getByText(/同步已完成/)).toHaveCount(0);
  await dialog.getByRole('button', { name: '继续同步', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toHaveLength(3); expect(writes[2]!.body).toEqual({ ...initial, cursor: 'next-cursor' });
  expect(await page.evaluate(() => localStorage.getItem('recruitment-demand-sync:operator'))).toBeNull();
});

test('unconfigured source in hiring is not represented as no matching demand', async ({ page }) => {
  const writes = await install(page, { configured: false });
  await page.goto('/talents?candidateId=candidate-A&applicationId=app-A');
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '提交录用', exact: true }).click();
  await expect(panel.getByText('钉钉招聘需求接入未就绪', { exact: true })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: '招聘需求单', exact: true })).toBeDisabled();
  await expect(panel.getByText(/当前应聘没有匹配的可用需求/)).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('missing application department opens its real editor while keeping hiring opinion', async ({ page }) => {
  const writes = await install(page, { departmentMissing: true });
  await page.goto('/talents?candidateId=candidate-A&applicationId=app-A');
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '提交录用', exact: true }).click();
  await panel.locator('.application-panel__command textarea').fill('保留意见，先补部门');
  await panel.getByRole('button', { name: '修改当前应聘（保留录用意见）', exact: true }).click();
  await expect(panel.locator('.application-panel__form')).toBeVisible();
  await expect(panel.getByRole('button', { name: '保存应聘', exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
});

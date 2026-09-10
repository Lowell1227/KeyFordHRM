import { test, expect, type Page } from '@playwright/test';

const employeeId = '11111111-1111-4111-8111-111111111111';
const hrId = '22222222-2222-4222-8222-222222222222';
const cycleId = '33333333-3333-4333-8333-333333333333';
const wrap = (data: unknown) => ({ code: 0, message: 'success', data });
async function setup(page: Page) {
  const records: Record<string, any>[] = [];
  const writes: { path: string; body: any }[] = [];
  let failSave = false;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'isolated-ledger-ui');
    localStorage.setItem('expiresAt', String(Date.now() + 3600000));
  });
  await page.route('**/api/v1/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    let result: unknown = {};
    if (req.method() !== 'GET') writes.push({ path, body: req.postDataJSON() });
    if (path.endsWith('/auth/me')) result = { id: hrId, name: '虚拟HR', sysRole: 'hr_user', canViewAll: false, businessCapabilities: { canHandleInterviews: true } };
    else if (path.endsWith('/notifications/unread-count')) result = 0;
    else if (path === '/api/v1/departments') result = [{ id: 'dept-1', name: '测试部门' }];
    else if (path === '/api/v1/interviews/cycles') result = [{ id: cycleId, name: '面谈参考周期', createdAt: '2026-09-01T08:00:00Z' }];
    else if (path === '/api/v1/interviews/people') result = [
      { id: hrId, name: '虚拟HR', employeeNo: 'HR001' },
      { id: employeeId, name: '虚拟员工', employeeNo: 'EMP001', dept: { name: '测试部门' } },
    ];
    else if (path === '/api/v1/interviews' && req.method() === 'POST') {
      if (failSave) return route.fulfill({ status: 409, json: { code: 4009, message: '记录保存失败，请重试' } });
      const body = req.postDataJSON();
      const record = { id: 'record-' + (records.length + 1), ...body, employeeName: '虚拟员工', employeeNo: 'EMP001', deptName: '测试部门',
        cycleId: body.cycleId ?? null, cycleName: body.cycleId ? '面谈参考周期' : null, interviewerName: '虚拟HR',
        recordedByName: '虚拟HR', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      records.push(record); result = record;
    } else if (path === '/api/v1/interviews') {
      const items = records.filter(item => !url.searchParams.get('cycleId') || item.cycleId === url.searchParams.get('cycleId'));
      result = { items, total: items.length, page: 1, pageSize: 10 };
    } else if (path.startsWith('/api/v1/interviews/record-')) {
      const item = records.find(item => path.endsWith(item.id))!;
      if (req.method() === 'PUT') Object.assign(item, req.postDataJSON());
      result = item;
    }
    await route.fulfill({ json: wrap(result) });
  });
  return { writes, records, failNextSave: () => { failSave = true; }, allowSave: () => { failSave = false; } };
}
async function fillNew(page: Page) {
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('combobox', { name: '员工', exact: true }).click();
  await page.getByRole('option', { name: '虚拟员工 · EMP001 · 测试部门', exact: true }).click();
  const date = drawer.getByPlaceholder('选择面谈时间');
  await date.fill('2026-09-10 10:30:00');
  await date.press('Tab');
  await drawer.getByPlaceholder('记录突出业绩和具体事例').fill('第一项成果已完成。\n下一步继续完善交付质量。');
}
for (const width of [1440, 390]) {
  test('HR 独立录入、查看和编辑面谈，员工可以有多条记录 ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await setup(page);
    await page.goto('/interviews');
    await expect(page.getByTestId('performance-cycle-filter')).toContainText('全部周期');
    await page.getByRole('button', { name: '新增面谈记录', exact: true }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: '保存面谈记录' }).click();
    await expect(drawer.locator('.el-form-item__error')).toContainText(['请选择员工', '请选择面谈时间']);
    expect(state.writes).toEqual([]);
    await fillNew(page);
    await drawer.getByRole('button', { name: '保存面谈记录' }).click();
    await expect(drawer).toBeHidden();
    expect(state.records[0].cycleId).toBeNull();
    await page.getByRole('button', { name: '查看详情', exact: true }).filter({ visible: true }).click();
    await expect(drawer).toContainText('未关联周期');
    await expect(drawer).toContainText('第一项成果已完成。');
    await expect(drawer.getByRole('button', { name: '保存面谈记录' })).toHaveCount(0);
    await expect(drawer).not.toContainText('签字');
    await expect(drawer).not.toContainText('截止');
    await drawer.screenshot({ path: test.info().outputPath('ledger-detail-' + width + '.png') });
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).filter({ visible: true }).click();
    await drawer.getByPlaceholder('记录商定的改进行动').fill('补充商定的改进行动');
    await drawer.getByRole('button', { name: '保存面谈记录' }).click();
    await expect(drawer).toBeHidden();
    await page.reload();
    await page.getByRole('button', { name: '查看详情', exact: true }).filter({ visible: true }).click();
    await expect(drawer).toContainText('补充商定的改进行动');
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '新增面谈记录', exact: true }).click();
    await fillNew(page);
    await drawer.getByRole('combobox', { name: '关联周期', exact: true }).click();
    await page.getByRole('option', { name: '面谈参考周期', exact: true }).click();
    await drawer.getByRole('button', { name: '保存面谈记录' }).click();
    await expect(drawer).toBeHidden();
    expect(state.records).toHaveLength(2);
    expect(state.records[1].cycleId).toBe(cycleId);
    expect(state.writes.map(item => item.path)).toEqual(['/api/v1/interviews', '/api/v1/interviews/record-1', '/api/v1/interviews']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('ledger-list-' + width + '.png'), fullPage: true });
  });
}
test('面谈保存失败保留输入，重试后才关闭抽屉', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/interviews');
  await page.getByRole('button', { name: '新增面谈记录', exact: true }).click();
  await fillNew(page);
  const drawer = page.getByRole('dialog');
  state.failNextSave();
  await drawer.getByRole('button', { name: '保存面谈记录' }).click();
  await expect(drawer.locator('.save-error')).toContainText('记录保存失败，请重试');
  await expect(drawer.getByPlaceholder('记录突出业绩和具体事例')).toHaveValue('第一项成果已完成。\n下一步继续完善交付质量。');
  state.allowSave();
  await drawer.getByRole('button', { name: '保存面谈记录' }).click();
  await expect(drawer).toBeHidden();
  expect(state.records).toHaveLength(1);
});

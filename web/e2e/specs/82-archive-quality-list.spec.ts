import { expect, test, type Page, type Route } from '@playwright/test';

const employee = (id = 'a', name = '档案甲') => ({
  id, name, employeeNo: `TEST-${id}`, deptId: 'dept', deptName: '测试部门',
  sysRole: 'employee', status: 'active', employmentType: 'full_time',
  position: '测试岗位', isAssessorOnly: false, canViewAll: false,
  hrCapabilities: [], businessIdentities: [], entryDate: '2024-01-01',
  archivedAt: null, dingtalkBindingState: 'enabled', companyTenure: '2年10个月',
});
const archive = (id: string) => ({
  ...employee(id, id === 'a' ? '档案甲' : '档案乙'), archiveVersion: 'v1',
  dept: { id: 'dept', name: '测试部门', company: 'fuede' },
  currentEmployment: null,
  employmentHistory: [{ id: 'future', companyText: '未来公司不应显示', effectiveFrom: '2099-01-01', employmentType: 'full_time', entryDate: '2099-01-01', employeeStatus: 'active' }],
  employeeProfile: null, changeHistory: [], rosterManager: null, performanceManager: null,
  dingtalkBinding: { userId: 'mock-ding', enabled: true, lastLoginAt: null },
  employeeContracts: [
    { id: 'old', name: '历史劳动合同', contractType: 'contract', signedAt: '2023-01-01', effectiveFrom: '2023-01-01', expiresAt: '2025-12-31', isActive: true, images: [], attachments: [] },
    { id: 'latest', name: '续签劳动合同', contractType: 'renewal', signedAt: '2026-10-01', effectiveFrom: '2026-10-01', expiresAt: '2028-09-30', isActive: true, images: [], attachments: [] },
  ],
});
async function respond(route: Route, data: unknown) {
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) });
}
async function mockPage(page: Page, intercept?: (route: Route, url: URL) => Promise<boolean>) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'archive-quality-mock');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (await intercept?.(route, url)) return;
    const path = url.pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 'admin', name: '测试管理员', sysRole: 'system_admin', canViewAll: true };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/departments')) data = [{ id: 'dept', name: '测试部门', company: 'fuede', children: [] }];
    else if (path.endsWith('/users')) data = { items: [employee(), employee('b', '档案乙')], total: 2, page: 1, pageSize: 20 };
    else if (/\/employee-archives\/[ab]$/.test(path)) data = archive(path.slice(-1));
    else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await respond(route, data);
  });
  await page.goto('/users');
  await expect(page.getByRole('button', { name: '查看档案', exact: true }).filter({ visible: true }).first()).toBeVisible();
}

for (const width of [1440, 1024, 390]) {
  test(`${width}px 导出选列采用已查询范围并可操作`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    let exportQuery: URLSearchParams | undefined;
    await mockPage(page, async (route, url) => {
      if (!url.pathname.endsWith('/users/export')) return false;
      exportQuery = url.searchParams;
      await route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: 'mock-xlsx' });
      return true;
    });
    await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill('尚未点击查询');
    await page.getByRole('button', { name: '导出花名册', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出花名册', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/2 名员工/)).toBeVisible();
    await dialog.getByRole('button', { name: '清空', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '导出 Excel', exact: true })).toBeDisabled();
    await dialog.getByText('姓名', { exact: true }).click();
    await dialog.getByText('本次司龄', { exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: '姓名', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: '本次司龄', exact: true })).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath(`export-${width}.png`), fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '导出 Excel', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/^花名册-\d{8}\.xlsx$/);
    expect(exportQuery?.get('columns')).toBe('name,companyTenure');
    expect(exportQuery?.has('keyword')).toBeFalsy();
    expect(exportQuery?.get('includeResigned')).toBe('true');
  });
}

test('快速连续查询时，旧响应不能覆盖最新结果', async ({ page }) => {
  let releaseSlow: (() => void) | undefined;
  let slowStarted = false;
  await mockPage(page, async (route, url) => {
    if (!url.pathname.endsWith('/users') || !url.searchParams.get('keyword')) return false;
    const slow = url.searchParams.get('keyword') === '慢查询';
    if (slow) { slowStarted = true; await new Promise<void>(resolve => { releaseSlow = resolve; }); }
    await respond(route, { items: [employee(slow ? 'slow' : 'fast', slow ? '慢查询员工' : '快查询员工')], total: 1 });
    return true;
  });
  const search = page.getByPlaceholder('搜索姓名、当前工号或历史工号');
  await search.fill('慢查询');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect.poll(() => slowStarted).toBeTruthy();
  await search.fill('快查询');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('快查询员工', { exact: true }).filter({ visible: true })).toBeVisible();
  const response = page.waitForResponse(res => res.url().includes('keyword=') && decodeURIComponent(res.url()).includes('慢查询'));
  releaseSlow?.();
  await response;
  await page.waitForTimeout(150);
  await expect(page.getByText('快查询员工', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('慢查询员工', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('查询失败有明确提示和重试，不伪装成空名单', async ({ page }) => {
  let fail = false;
  await mockPage(page, async (route, url) => {
    if (!fail || !url.pathname.endsWith('/users')) return false;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporarily unavailable' }) });
    return true;
  });
  fail = true;
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('员工列表加载失败，请重试。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出花名册', exact: true })).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('档案甲', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('员工列表加载失败，请重试。', { exact: true })).toHaveCount(0);
});

test('办理中变更不提供与当前内容无关的花名册导出', async ({ page }) => {
  await mockPage(page);
  await page.getByRole('tab', { name: '办理中变更', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出花名册', exact: true })).toHaveCount(0);
});

test('最新合同只展开一份，历史可展开，详情不冒用未来任职', async ({ page }) => {
  await mockPage(page);
  await page.getByRole('button', { name: '查看档案', exact: true }).filter({ visible: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await expect(drawer.getByText('2年10个月', { exact: true })).toBeVisible();
  await expect(drawer.getByText('未来公司不应显示', { exact: true })).toHaveCount(0);
  await drawer.getByRole('tab', { name: '合同材料', exact: true }).click();
  await expect(drawer.getByText('最新合同', { exact: true })).toBeVisible();
  await expect(drawer.locator('.employee-archive__contract-card').filter({ visible: true })).toHaveCount(1);
  await expect(drawer.locator('.employee-archive__contract-head')).toContainText('续签劳动合同');
  await drawer.getByRole('button', { name: /历史合同/ }).click();
  await expect(drawer.locator('.employee-archive__contract-card').filter({ visible: true })).toHaveCount(2);
  await expect(drawer.locator('.employee-archive__contract-head').filter({ hasText: '历史劳动合同' })).toBeVisible();
});

test('Excel 接口失败显示可读原因并保留勾选字段', async ({ page }) => {
  await mockPage(page, async (route, url) => {
    if (!url.pathname.endsWith('/users/export')) return false;
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '导出数量超过 5000 条，请缩小筛选范围' }) });
    return true;
  });
  await page.getByRole('button', { name: '导出花名册', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出花名册', exact: true });
  await dialog.getByRole('button', { name: '导出 Excel', exact: true }).click();
  await expect(dialog.getByText('导出数量超过 5000 条，请缩小筛选范围', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: '姓名', exact: true })).toBeChecked();
});

test('钉钉操作完成后不会把下一位员工的详情覆盖回上一位', async ({ page }) => {
  let releaseWrite: (() => void) | undefined;
  let writeStarted = false;
  await mockPage(page, async (route, url) => {
    if (url.pathname.endsWith('/employee-archives/a/dingtalk-binding')) {
      writeStarted = true;
      await new Promise<void>(resolve => { releaseWrite = resolve; });
      await respond(route, {});
      return true;
    }
    if (url.pathname.endsWith('/employee-archives/a')) {
      await respond(route, { ...archive('a'), dingtalkBindingState: writeStarted ? 'enabled' : 'disabled' });
      return true;
    }
    return false;
  });
  await page.getByRole('button', { name: '查看档案', exact: true }).filter({ visible: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await drawer.locator('.el-switch__core').click();
  await expect.poll(() => writeStarted).toBeTruthy();
  await drawer.getByRole('button', { name: '下一位待处理', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: '档案乙', exact: true })).toBeVisible();
  const refreshed = page.waitForResponse(res => res.url().endsWith('/employee-archives/a'));
  releaseWrite?.();
  await refreshed;
  await page.waitForTimeout(150);
  await expect(drawer.getByRole('heading', { name: '档案乙', exact: true })).toBeVisible();
});

test('详情读取失败保留抽屉并可重试', async ({ page }) => {
  let fail = true;
  await mockPage(page, async (route, url) => {
    if (!fail || !url.pathname.endsWith('/employee-archives/a')) return false;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporarily unavailable' }) });
    return true;
  });
  await page.getByRole('button', { name: '查看档案', exact: true }).filter({ visible: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '员工档案', exact: true });
  await expect(drawer.getByText('档案加载失败，请重试。', { exact: true })).toBeVisible();
  fail = false;
  await drawer.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: '档案甲', exact: true })).toBeVisible();
});

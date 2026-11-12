import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  const searches: URL[] = [];
  const writes: string[] = [];
  const drafts: any[] = [];
  const state = { failSearch: false, delayOld: false, delayDetails: false };
  const employee = (id: string, archived = false, name = '虚构同名') => ({
    id, name, employeeNo: archived ? 'OLD002' : 'OLD001', status: 'resigned',
    archivedAt: archived ? '2025-01-01' : null, deptId: 'dept', deptName: archived ? '历史部门乙' : '历史部门甲',
    position: '虚构岗位', sysRole: 'employee', employmentType: 'full_time',
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'unified-onboarding-mock');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    let data: any = [];
    if (request.method() !== 'GET') writes.push(path);
    if (path === '/auth/me') data = { id: 'admin', name: '虚构管理员', sysRole: 'system_admin', canViewAll: true };
    else if (path === '/notifications/unread-count') data = 0;
    else if (path === '/departments') data = [{ id: 'dept', name: '虚构部门', children: [] }];
    else if (path === '/users') {
      let items: any[] = [];
      if (url.searchParams.get('status') === 'resigned' && url.searchParams.get('keyword')) {
        searches.push(url);
        if (state.failSearch) return route.fulfill({ status: 503, json: { message: '查询暂不可用' } });
        const keyword = url.searchParams.get('keyword');
        if (state.delayOld && keyword === '旧查询') await new Promise(resolve => setTimeout(resolve, 850));
        // Match the current API's implicit conversion: explicit "false" also becomes true.
        const archived = Boolean(url.searchParams.get('archived'));
        if (keyword !== '全新人员') items = [employee(archived ? 'old-archived' : 'old-retained', archived, keyword!)];
      }
      data = { items, total: items.length, page: 1, pageSize: 5 };
    } else if (path.startsWith('/users/')) {
      if (state.delayDetails) await new Promise(resolve => setTimeout(resolve, 1500));
      data = employee(path.split('/').at(-1)!, path.endsWith('old-archived'));
    }
    else if (path.endsWith('/reentry/current')) data = null;
    else if (/^\/employee-archives\/old-/.test(path)) data = { ...employee('old-archived', true), currentEmployment: null, employmentHistory: [], employeeContracts: [], changeHistory: [] };
    else if (path === '/employee-archives/drafts' && request.method() === 'POST') {
      drafts.push(request.postDataJSON());
      data = { id: 'new-draft', sourceType: 'manual_employee_create', recordStatus: 'draft', requestVersion: drafts.length, proposedValue: drafts.at(-1) };
    } else if (path === '/employee-archives/identity-lookup') data = { outcome: 'none', candidates: [] };
    else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: { code: 0, message: 'success', data } });
  });
  await page.goto('/entry-exit');
  await expect(page.getByRole('button', { name: '办理入职', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '办理再入职', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '办理入职', exact: true });
  return { drawer, searches, writes, drafts, state };
}

for (const width of [1440, 1024, 390]) {
  test(`${width}px 姓名匹配包含已归档离职人员，明确选择后进入再入职`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { drawer, searches, writes, drafts } = await setup(page);
    await drawer.getByLabel('姓名', { exact: true }).fill('虚构同名');
    const matches = drawer.getByRole('region', { name: '同名离职员工' });
    await expect(matches.getByRole('button', { name: /^选择 .* 再入职$/ })).toHaveCount(2);
    await expect(matches).toContainText('OLD001');
    await expect(matches).toContainText('OLD002');
    await expect(matches).toContainText('已归档');
    expect(searches.some(url => url.searchParams.get('archived') === 'true')).toBeTruthy();
    expect(searches.some(url => !url.searchParams.has('archived'))).toBeTruthy();
    expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBeTruthy();
    await drawer.screenshot({ path: testInfo.outputPath(`unified-entry-${width}.png`), animations: 'disabled' });
    await matches.getByRole('button', { name: /^选择 .* 再入职$/ }).last().click();
    await expect(drawer).not.toBeVisible();
    const reentry = page.getByRole('dialog', { name: '办理再入职', exact: true });
    await expect(reentry).toBeVisible();
    await expect(reentry).toContainText('历史工号 OLD002');
    expect(drafts.at(-1)?.name).toBe('虚构同名');
    expect(writes.every(path => path === '/employee-archives/drafts')).toBeTruthy();
  });
}

test('没有姓名匹配可继续新员工填写，姓名匹配不替代手机号查重', async ({ page }) => {
  const { drawer, writes, searches } = await setup(page);
  await drawer.getByLabel('姓名', { exact: true }).fill('全新人员');
  const matches = drawer.getByRole('region', { name: '同名离职员工' });
  await expect.poll(() => searches.length).toBe(2);
  await expect(matches).not.toBeVisible();
  await drawer.getByLabel('手机号', { exact: true }).fill('19900000001');
  await drawer.getByLabel('手机号', { exact: true }).press('Tab');
  await expect.poll(() => writes.includes('/employee-archives/identity-lookup')).toBeTruthy();
  await drawer.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: '任职信息', exact: true })).toBeVisible();
});

test('迟到的姓名查询不覆盖新姓名，清空姓名立即清空匹配', async ({ page }) => {
  const { drawer, state, searches } = await setup(page);
  state.delayOld = true;
  const name = drawer.getByLabel('姓名', { exact: true });
  await name.fill('旧查询');
  await expect.poll(() => searches.length).toBe(2);
  await name.fill('新查询');
  const matches = drawer.getByRole('region', { name: '同名离职员工' });
  await expect(matches.getByRole('button', { name: /^选择 .* 再入职$/ })).toHaveCount(2);
  await expect(matches).toContainText('新查询');
  await page.waitForTimeout(900);
  await expect(matches).not.toContainText('旧查询');
  await name.clear();
  await expect(matches).not.toBeVisible();
});

test('姓名查询失败可重试并保留填写内容', async ({ page }) => {
  const { drawer, state } = await setup(page);
  state.failSearch = true;
  const name = drawer.getByLabel('姓名', { exact: true });
  await name.fill('虚构同名');
  const matches = drawer.getByRole('region', { name: '同名离职员工' });
  await expect(matches.getByRole('button', { name: /重试/ })).toBeVisible();
  await expect(name).toHaveValue('虚构同名');
  state.failSearch = false;
  await matches.getByRole('button', { name: /重试/ }).click();
  await expect(matches.getByRole('button', { name: /^选择 .* 再入职$/ })).toHaveCount(2);
});

test('重新办理入职后，迟到的上一位员工详情不能打开再入职抽屉', async ({ page }) => {
  const { drawer, state } = await setup(page);
  state.delayDetails = true;
  await drawer.getByLabel('姓名', { exact: true }).fill('虚构同名');
  const matches = drawer.getByRole('region', { name: '同名离职员工' });
  await matches.getByRole('button', { name: /^选择 .* 再入职$/ }).first().click();
  await expect(drawer).not.toBeVisible();
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  await drawer.getByLabel('姓名', { exact: true }).fill('全新人员');
  await page.waitForTimeout(1700);
  await expect(page.getByRole('dialog', { name: '办理再入职', exact: true })).not.toBeVisible();
  await expect(drawer.getByLabel('姓名', { exact: true })).toHaveValue('全新人员');
});

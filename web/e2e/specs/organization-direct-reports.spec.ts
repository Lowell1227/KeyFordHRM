import { expect, test, type Page } from '@playwright/test';

const response = (data: unknown) => ({ code: 0, message: 'success', data });
const reports = [
  { id: 'report-1', name: '直属员工甲', employeeNo: '101', deptId: 'dept-1', deptName: '人事组', position: '人事专员', status: 'active', sysRole: 'employee', directManagerId: 'manager-1', avatarUrl: null },
  { id: 'report-2', name: '直属员工乙', employeeNo: '102', deptId: 'dept-2', deptName: '跨部门的长名称组织示例', position: '岗位名称很长的试用期专员', status: 'probation', sysRole: 'employee', directManagerId: 'manager-1', avatarUrl: null },
];

async function mockPeople(page: Page, role = 'system_admin', failFirst = false, people = reports) {
  let requests = 0;
  const employee = {
    id: 'employee-1', name: '普通员工', employeeNo: '103', deptId: 'dept-1', deptName: '人事组', position: '专员',
    employmentType: 'full_time', status: 'active', sysRole: 'employee', isAssessorOnly: false, canViewAll: false,
    directManagerName: '方园', directManagerId: 'manager-1', directReportCount: 0, businessIdentities: [],
  };
  const manager = { ...employee, id: 'manager-1', name: '方园', employeeNo: '319', directReportCount: people.length,
    businessIdentities: [{ type: 'performance_manager', label: '绩效直属上级', count: 2 }, { type: 'cycle_hr_owner', label: '本周期 HR 负责人', count: 1 }] };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-admin-token');
    localStorage.setItem('expiresAt', String(Date.now() + 600000));
  });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: response({ id: 'admin-1', name: '管理员', sysRole: role, canViewAll: true, hrCapabilities: ['organization_edit', 'employee_archive_edit'] }) });
    if (url.pathname.endsWith('/notifications/unread-count')) return route.fulfill({ json: response(0) });
    if (url.pathname.includes('/subordinates')) {
      requests++;
      if (failFirst && requests === 1) return route.fulfill({ status: 500, json: { code: 500, message: '名单暂时不可用' } });
      return route.fulfill({ json: response(people) });
    }
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: response({ total: url.searchParams.get('unassigned') ? 0 : 2, page: 1, pageSize: 20, items: url.searchParams.get('unassigned') ? [] : [manager, employee] }) });
    if (url.pathname.endsWith('/departments')) return route.fulfill({ json: response([{ id: 'dept-1', name: '人事组', fullPath: '人事组', parentId: null, company: 'fuede', isActive: true, memberCount: 2, directMemberCount: 2, leaderName: '姚瑶', effectiveApproverName: '李宏', effectiveApproverId: 'leader-1', children: [] }]) });
    if (url.pathname.includes('/applications/list') || url.pathname.includes('/reviews/list')) return route.fulfill({ json: response({ total: 0, page: 1, pageSize: 20, items: [] }) });
    return route.fulfill({ json: response([]) });
  });
  return () => requests;
}

for (const width of [1440, 1024, 390]) {
  test(`direct reports replace duties and open on hover focus or tap at ${width}px`, async ({ page }, testInfo) => {
    const requests = await mockPeople(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/organization');
    const region = width <= 768 ? page.locator('.org-member-mobile-list') : page.locator('.org-detail .desktop-result-table');
    await expect(region).toContainText('直属下属');
    await expect(region).not.toContainText('业务职责');
    await expect(region).not.toContainText('本周期 HR 负责人');
    const trigger = region.getByRole('button', { name: '查看方园的直属下属（2人）', exact: true });
    await expect(trigger).toHaveText('2人');
    await expect(region.getByText('0人', { exact: true })).toBeVisible();
    expect(requests()).toBe(0);
    if (width === 1440) await trigger.hover();
    else if (width === 1024) await trigger.focus();
    else await trigger.click();
    const list = page.getByRole('list', { name: '方园的直属下属' });
    await expect(list.getByText('直属员工甲', { exact: true })).toBeVisible();
    await expect(list.getByText('直属员工乙', { exact: true })).toBeVisible();
    await expect(list).toContainText('跨部门的长名称组织示例');
    await expect(list).toContainText('岗位名称很长的试用期专员');
    expect(requests()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await list.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`direct-reports-${width}.png`), fullPage: true });
  });
}

test('report list failure offers retry without pretending there are zero reports', async ({ page }) => {
  const requests = await mockPeople(page, 'system_admin', true);
  await page.goto('/organization');
  const trigger = page.locator('.org-detail .desktop-result-table').getByRole('button', { name: '查看方园的直属下属（2人）' });
  await trigger.focus();
  await expect(page.getByRole('alert').filter({ hasText: '名单加载失败' })).toBeVisible();
  await expect(trigger).toHaveText('2人');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: '方园的直属下属' })).toContainText('直属员工乙');
  expect(requests()).toBe(2);
});

test('a large direct-report list scrolls within the popup and closes with Escape', async ({ page }) => {
  const people = Array.from({ length: 20 }, (_, index) => ({ ...reports[0], id: `report-${index}`, name: `直属员工${index + 1}` }));
  await mockPeople(page, 'system_admin', false, people);
  await page.goto('/organization');
  await page.locator('.org-detail .desktop-result-table').getByRole('button', { name: '查看方园的直属下属（20人）' }).focus();
  const list = page.getByRole('list', { name: '方园的直属下属' });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(list).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await list.getByText('直属员工20', { exact: true }).scrollIntoViewIfNeeded();
  await expect(list.getByText('直属员工20', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).not.toBeVisible();
});

test('touching the report count again closes the list', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await mockPeople(page);
  await page.goto('/organization');
  const trigger = page.locator('.org-member-mobile-list').getByRole('button', { name: '查看方园的直属下属（2人）' });
  const list = page.getByRole('list', { name: '方园的直属下属' });
  await trigger.tap();
  await expect(list).toBeVisible();
  await trigger.tap();
  await expect(list).not.toBeVisible();
  await context.close();
});

for (const role of ['system_admin', 'hr', 'hr_user']) {
  test(`roster import is unavailable to ${role} while personnel maintenance remains available`, async ({ page }) => {
    await mockPeople(page, role);
    await page.goto('/users');
    await expect(page.locator('.directory-view')).toBeVisible();
    await expect(page.getByRole('button', { name: '导入花名册', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '花名册导入预检' })).toHaveCount(0);
    await expect(page.locator('.directory-view .desktop-result-table').getByRole('button', { name: '查看档案', exact: true }).first()).toBeVisible();
  });
}

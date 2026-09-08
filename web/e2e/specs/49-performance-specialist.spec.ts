import { test, expect } from '@playwright/test';
import { buildNavigation } from '../../src/router/navigation';
import { routes } from '../../src/router/routes';

test('performance specialist receives cycle and publication entries without unrelated authority', () => {
  const navigation = JSON.stringify(buildNavigation(routes, {
    sysRole: 'hr_user', canViewAll: false,
    hrCapabilities: ['cycle_plan_edit', 'performance_publish'],
  }));
  expect(navigation).toContain('结果公示');
  expect(navigation).toContain('周期与计划');
  expect(navigation).not.toContain('结果审批');
  expect(navigation).not.toContain('绩效校准');
  expect(navigation).not.toContain('人员管理');
  const editor = JSON.stringify(buildNavigation(routes, { sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit'] }));
  expect(editor).not.toContain('结果公示');
});

for (const width of [1440, 390]) test(`administrator assigns specialist while preserving other HR abilities ${width}`, async ({ page }, testInfo) => {
  const envelope = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });
  const employee = {
    id: 'employee-specialist', name: '绩效测试专员', employeeNo: 'QA001',
    sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], status: 'active',
    deptId: 'dept-hr', deptName: '人事部', employmentType: 'full_time',
    directManagerId: null, directManagerName: null, isAssessorOnly: false, canViewAll: false,
  };
  const saved: any[] = [];
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'isolated-specialist-test');
    localStorage.setItem('expiresAt', String(Date.now() + 600000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname.endsWith('/auth/me')) data = { id: 'admin', name: '管理员', sysRole: 'system_admin', canViewAll: true, deptId: null, isAssessorOnly: false };
    else if (url.pathname.includes('/notifications/unread-count')) data = 0;
    else if (url.pathname.includes('/departments')) data = [{ id: 'dept-hr', name: '人事部', parentId: null, children: [], memberCount: 1 }];
    else if (url.pathname.endsWith('/settings') && route.request().method() === 'PATCH') {
      saved.push(route.request().postDataJSON()); data = { ...employee, ...saved.at(-1) };
    } else if (url.pathname.includes('/users')) data = { items: [employee], total: 1, page: 1, pageSize: 20 };
    await route.fulfill({ json: envelope(data) });
  });
  await page.goto('/users');
  await page.getByRole('button', { name: '人员设置', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '人员设置' });
  await dialog.getByTestId('performance-specialist-role').check();
  await expect(dialog.getByRole('checkbox', { name: '考核周期创建与编辑', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '结果公示', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '员工档案编辑', exact: true })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath(`specialist-${width}.png`), fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: /保存/ }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].hrCapabilities).toEqual(['cycle_plan_edit', 'employee_archive_edit', 'performance_publish']);
  expect(saved[0].sysRole).toBe('hr_user');
});

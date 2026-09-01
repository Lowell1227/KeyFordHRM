import { expect, test } from '@playwright/test';
import { routes } from '../../src/router/routes';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });
const webBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test('personnel master data has four independent routes', () => {
  expect(routes.filter((route) => ['/users', '/organization', '/positions', '/personnel-change-reviews'].includes(route.path)).map((route) => route.meta?.title))
    .toEqual(['员工档案', '组织架构', '岗位目录', '人事变更审核']);
});

test('HR can submit a position from the position directory', async ({ page }) => {
  let submitted: unknown = null;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-admin-token');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(0)) }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ id: 'admin-1', name: '系统管理员', sysRole: 'system_admin', canViewAll: true })) }));
  await page.route('**/api/v1/positions**', async (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse({ id: 'request-1', status: 'pending' })) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse([{ id: 'p1', code: 'SALES-01', name: '销售专员', jobFamily: '销售', isActive: true, activeEmployeeCount: 6 }])) });
  });

  await page.goto(`${webBaseUrl}/positions`);
  await expect(page.getByText('销售专员', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增岗位' }).click();
  const dialog = page.getByRole('dialog', { name: '新增岗位' });
  await dialog.locator('.el-form-item').filter({ hasText: '岗位编码' }).locator('input').fill('OPS-01');
  await dialog.locator('.el-form-item').filter({ hasText: '岗位名称' }).locator('input').fill('运营专员');
  await dialog.locator('.el-form-item').filter({ hasText: '岗位族' }).locator('input').fill('运营');
  await dialog.getByRole('button', { name: '提交审核' }).click();
  await expect.poll(() => submitted).toEqual({ code: 'OPS-01', name: '运营专员', jobFamily: '运营' });
});

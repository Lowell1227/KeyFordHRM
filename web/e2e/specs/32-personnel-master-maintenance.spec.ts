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

test('HR administrator can review self-submitted department and position changes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-hr-admin-token');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'hr-admin-1',
      name: 'HR管理员',
      sysRole: 'hr',
      canViewAll: true,
      hrCapabilities: ['employee_archive_review', 'organization_edit'],
    })),
  }));
  await page.route('**/api/v1/employee-archives/reviews/list**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({ items: [], total: 0, page: 1, pageSize: 50 })),
  }));
  await page.route('**/api/v1/departments/change-requests**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      items: [{
        id: 'department-request-1',
        departmentId: null,
        departmentName: '自建部门',
        action: 'create',
        status: 'pending',
        baseValue: {},
        proposedValue: { name: '自建部门' },
        createdBy: { id: 'hr-admin-1', name: 'HR管理员' },
        createdAt: '2026-09-01T07:30:00.000Z',
      }],
      total: 1,
      page: 1,
      pageSize: 50,
    })),
  }));
  await page.route('**/api/v1/positions/change-requests**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      items: [{
        id: 'position-request-1',
        positionId: null,
        positionName: '自建岗位',
        action: 'create',
        status: 'pending',
        baseValue: {},
        proposedValue: { code: 'SELF-01', name: '自建岗位', jobFamily: '测试' },
        warnings: [],
        createdBy: { id: 'hr-admin-1', name: 'HR管理员' },
        createdAt: '2026-09-01T07:31:00.000Z',
      }],
      total: 1,
      page: 1,
      pageSize: 50,
    })),
  }));

  await page.goto(`${webBaseUrl}/personnel-change-reviews`);
  await page.getByRole('button', { name: '组织架构 1' }).click();
  const departmentCard = page.locator('.department-review-card').filter({ hasText: '自建部门' });
  await expect(departmentCard.getByRole('button', { name: '退回' })).toBeEnabled();
  await expect(departmentCard.getByRole('button', { name: '通过' })).toBeEnabled();

  await page.getByRole('button', { name: '岗位目录 1' }).click();
  const positionCard = page.locator('.department-review-card').filter({ hasText: '自建岗位' });
  await expect(positionCard.getByRole('button', { name: '退回' })).toBeEnabled();
  await expect(positionCard.getByRole('button', { name: '通过' })).toBeEnabled();
});

import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, account = 'HR001') {
  await page.goto('/login');
  if (account !== 'HR001') {
    await page.getByTestId('preview-account').click();
    await page.getByRole('option').filter({ hasText: `(${account})` }).click();
  }
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('linked employee ID opens the exact same-name archive, independent of roster filters', async ({ page, request }) => {
  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await request.get('/api/v1/users?status=resigned&archived=true&keyword=' + encodeURIComponent('预览离职员工'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const person = (await response.json()).data.items.find((row: { employeeNo: string }) => row.employeeNo === 'PREVIEW_EXIT002');
  expect(person).toBeTruthy();
  await page.goto(`/users?employeeId=${person.id}`);
  const drawer = page.locator('.employee-archive-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('PREVIEW_EXIT002');
  await expect(drawer).not.toContainText('PREVIEW_EXIT001');
  await page.reload();
  await expect(drawer).toContainText('PREVIEW_EXIT002');
});

test('inaccessible linked archive stays an explicit error rather than a name fallback', async ({ page }) => {
  await login(page);
  await page.goto('/users?employeeId=00000000-0000-4000-8000-000000000099');
  const drawer = page.locator('.employee-archive-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('员工档案不存在或已不可访问');
  await expect(drawer.getByRole('button', { name: '提交', exact: true })).toHaveCount(0);
});

test('unprivileged employee cannot use a linked archive URL', async ({ page, request }) => {
  await login(page, 'EMP001');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await request.get('/api/v1/employee-archives/00000000-0000-4000-8000-000000000099', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(403);
  await page.goto('/users?employeeId=00000000-0000-4000-8000-000000000099');
  await expect(page.locator('.employee-archive-drawer')).toHaveCount(0);
});

test('onboarding opens with action title and no future-flow block on initial step', async ({ page }) => {
  await login(page);
  await page.goto('/entry-exit');
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const drawer = page.locator('.employee-create-drawer');
  await expect(drawer.getByRole('heading', { name: '办理入职', exact: true })).toBeVisible();
  await expect(drawer.getByText('后续办理流程', { exact: true })).toHaveCount(0);
  await expect(drawer.getByText('提交审核 → 审核通过 → 确认到岗 → 入职生效', { exact: true })).not.toBeVisible();
});

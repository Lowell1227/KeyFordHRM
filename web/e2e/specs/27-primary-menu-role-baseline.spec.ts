import { expect, test, type Page } from '@playwright/test';

async function loginWithPassword(page: Page, employeeNo: string) {
  await page.goto('/login');
  await page.getByTestId('password-login-toggle').click();
  await page.getByTestId('login-employee-no').fill(employeeNo);
  await page.getByTestId('login-password').fill('000000');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function expectPrimaryModules(page: Page, labels: string[]) {
  const modules = page.locator('.rail-item[data-testid^="nav-module-"]');
  await expect(modules).toHaveCount(labels.length);
  await expect(modules).toHaveText(labels);
}

test.describe('一级菜单角色基线', () => {
  test('系统管理员看到完整业务域和两个只读规划模块', async ({ page }) => {
    await loginWithPassword(page, 'ADMIN');

    await expectPrimaryModules(page, [
      '工作台',
      '绩效',
      '人员',
      '招聘规划中',
      '薪酬规划中',
      '系统管理',
    ]);

    await page.goto('/recruitment');
    await expect(page.getByRole('heading', { name: '招聘（规划中）' })).toBeVisible();
    await expect(page.getByTestId('recruitment-overview').locator('button, input, textarea, select')).toHaveCount(0);

    await page.goto('/compensation');
    await expect(page.getByRole('heading', { name: '薪酬（规划中）' })).toBeVisible();
    await expect(page.getByTestId('compensation-overview').locator('button, input, textarea, select')).toHaveCount(0);
  });

  test('HR 看到人员和系统管理且不能进入规划模块', async ({ page }) => {
    await loginWithPassword(page, 'HR001');

    await expectPrimaryModules(page, ['工作台', '绩效', '人员', '系统管理']);
    await page.goto('/recruitment');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/compensation');
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto('/system');
    await expect(page.getByText('组织、人员、任职和花名册直属主管均以 HRM 花名册为准，不读取或同步钉钉组织。')).toBeVisible();
  });

  test('员工只看到工作台、绩效和人员且不能进入系统管理', async ({ page }) => {
    await loginWithPassword(page, 'EMP001');

    await expectPrimaryModules(page, ['工作台', '绩效', '人员']);
    await page.goto('/recruitment');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/compensation');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/system');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

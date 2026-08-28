import { test, expect } from '@playwright/test';
import { LoginPage } from '../page-objects/login.page';
import { ACCEPTANCE_ACCOUNTS, ACCEPTANCE_PASSWORD } from '../fixtures/acceptance-accounts';

test.describe('01-login-flows', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('local password login success', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithPassword(ACCEPTANCE_ACCOUNTS.employee, ACCEPTANCE_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('invalid password shows error', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await page.getByTestId('password-login-toggle').click();
    await login.employeeNoInput.fill(ACCEPTANCE_ACCOUNTS.employee);
    await login.passwordInput.fill('wrong');
    const unauthorizedResponse = page.waitForResponse((response) => (
      response.url().includes('/api/v1/auth/login') && response.status() === 401
    ));
    await login.submitButton.click();
    await unauthorizedResponse;

    const passwordField = page.locator('.el-form-item').filter({ has: login.passwordInput });
    await expect(passwordField).toContainText('工号或密码错误');
    await expect(page.locator('.el-message--error')).toHaveCount(0);

    const inputBox = await login.passwordInput.boundingBox();
    const errorBox = await passwordField.getByText('工号或密码错误', { exact: true }).boundingBox();
    expect(inputBox).not.toBeNull();
    expect(errorBox).not.toBeNull();
    expect(errorBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);
  });

  test('empty login fields show their own inline errors', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await page.getByTestId('password-login-toggle').click();
    await login.submitButton.click();

    const employeeNoField = page.locator('.el-form-item').filter({ has: login.employeeNoInput });
    const passwordField = page.locator('.el-form-item').filter({ has: login.passwordInput });
    await expect(employeeNoField).toContainText('请输入工号');
    await expect(passwordField).toContainText('请输入密码');
    await expect(page.locator('.el-message')).toHaveCount(0);
  });

  test('login page no longer requests or displays acceptance accounts', async ({ page }) => {
    let testAccountsRequestCount = 0;
    await page.route('**/api/v1/auth/test-accounts', async (route) => {
      testAccountsRequestCount += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            enabled: true,
            accounts: [{ employeeNo: 'E2E_ADMIN', name: '测试管理员', roleLabel: '系统管理员' }],
          },
        }),
      });
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('test-account-login-toggle')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '验收账号登录' })).toHaveCount(0);
    expect(testAccountsRequestCount).toBe(0);
  });

  test('refresh keeps login', async ({ page, context }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithPassword(ACCEPTANCE_ACCOUNTS.employee, ACCEPTANCE_PASSWORD);
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('401 redirects to login', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/login/);
  });

  test('logout removes auth', async ({ page, context }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithPassword(ACCEPTANCE_ACCOUNTS.employee, ACCEPTANCE_PASSWORD);
    await page.getByTestId('header-user-menu').click();
    await page.getByTestId('header-logout').click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

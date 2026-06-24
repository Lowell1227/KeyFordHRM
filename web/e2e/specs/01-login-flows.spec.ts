import { test, expect } from '@playwright/test';
import { LoginPage } from '../page-objects/login.page';

test.describe('01-login-flows', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('local password login success', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithPassword('EMP001', '000000');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('invalid password shows error', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.employeeNoInput.fill('EMP001');
    await login.passwordInput.fill('wrong');
    await login.submitButton.click();
    await expect(page.locator('.el-message--error')).toContainText('工号或密码错误');
  });

  test('refresh keeps login', async ({ page, context }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithPassword('EMP001', '000000');
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
    await login.loginWithPassword('EMP001', '000000');
    await page.getByTestId('header-user-menu').click();
    await page.getByTestId('header-logout').click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

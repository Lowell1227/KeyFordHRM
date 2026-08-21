import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const loginViewPath = fileURLToPath(new URL('../../src/views/auth/LoginView.vue', import.meta.url));
const authApiPath = fileURLToPath(new URL('../../src/api/auth.api.ts', import.meta.url));
const authStorePath = fileURLToPath(new URL('../../src/stores/auth.store.ts', import.meta.url));

test.describe('受控测试账号快捷登录', () => {
  test('有测试身份时默认折叠并说明验收数据边界', async ({ page }) => {
    await page.route('**/api/v1/auth/test-accounts', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            enabled: true,
            accounts: [
              { employeeNo: 'HR001', name: '测试·姚遥', sysRole: 'hr', roleLabel: 'HR' },
              { employeeNo: 'MGR001', name: '测试·周强明', sysRole: 'manager', roleLabel: '主管' },
            ],
          },
        }),
      });
    });

    await page.goto('/login');

    const toggle = page.getByTestId('test-account-login-toggle');
    const panel = page.getByTestId('test-account-login');
    await expect(toggle).toContainText('验收账号登录');
    await expect(panel).toBeHidden();

    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('仅用于测试组织与测试数据');
    await expect(panel.getByTestId('test-account-login-button')).toHaveCount(2);
  });

  test('登录页从后端读取测试身份且不再内置统一密码', async () => {
    const source = await readFile(loginViewPath, 'utf8');

    expect(source).toContain('authApi.getTestAccounts()');
    expect(source).toContain('data-testid="test-account-login"');
    expect(source).not.toContain('QUICK_PASSWORD');
    expect(source).not.toContain("const isDev = import.meta.env.DEV");
    expect(source).not.toContain("password = '000000'");
  });

  test('测试身份使用独立的后端受控登录接口', async () => {
    const [apiSource, storeSource] = await Promise.all([
      readFile(authApiPath, 'utf8'),
      readFile(authStorePath, 'utf8'),
    ]);

    expect(apiSource).toContain("http.get('/auth/test-accounts')");
    expect(apiSource).toContain("http.post('/auth/test-login', { employeeNo }");
    expect(storeSource).toContain('loginWithTestAccount(employeeNo: string)');
    expect(storeSource).not.toMatch(/loginWithTestAccount[\s\S]{0,300}localLogin/);
  });
});

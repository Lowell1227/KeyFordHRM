import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const authApiPath = fileURLToPath(new URL('../../src/api/auth.api.ts', import.meta.url));
const authStorePath = fileURLToPath(new URL('../../src/stores/auth.store.ts', import.meta.url));

test.describe('登录页工号登录', () => {
  test('登录页不再请求或展示验收账号', async ({ page }) => {
    let testAccountsRequestCount = 0;
    await page.route('**/api/v1/auth/test-accounts', async (route) => {
      testAccountsRequestCount += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            enabled: true,
            accounts: [
              { employeeNo: 'HR001', name: '测试·姚遥', sysRole: 'hr', roleLabel: 'HR 管理员' },
              { employeeNo: 'MGR001', name: '测试·周强明', sysRole: 'employee', roleLabel: '绩效直属上级场景' },
            ],
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

  test('错误密码在密码框下方显示红字且不弹顶部消息', async ({ page }) => {
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 4010, message: '工号或密码错误', data: null }),
      });
    });

    await page.goto('/login');
    await page.getByTestId('password-login-toggle').click();
    const employeeNoInput = page.getByTestId('login-employee-no');
    const passwordInput = page.getByTestId('login-password');
    await employeeNoInput.fill('335');
    await passwordInput.fill('wrong');
    await page.getByTestId('login-submit').click();

    const passwordField = page.locator('.el-form-item').filter({ has: passwordInput });
    const inlineError = passwordField.getByText('工号或密码错误', { exact: true });
    await expect(inlineError).toBeVisible();
    await expect(page.locator('.el-message--error')).toHaveCount(0);

    const inputBox = await passwordInput.boundingBox();
    const errorBox = await inlineError.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(errorBox).not.toBeNull();
    expect(errorBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);
  });

  test('空工号和空密码分别在输入框下方提示', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('password-login-toggle').click();
    await page.getByTestId('login-submit').click();

    const employeeNoInput = page.getByTestId('login-employee-no');
    const passwordInput = page.getByTestId('login-password');
    const employeeNoField = page.locator('.el-form-item').filter({ has: employeeNoInput });
    const passwordField = page.locator('.el-form-item').filter({ has: passwordInput });
    await expect(employeeNoField).toContainText('请输入工号');
    await expect(passwordField).toContainText('请输入密码');
    await expect(page.locator('.el-message')).toHaveCount(0);
  });

  test('后端受控测试接口保持独立，供非登录页验收工具使用', async () => {
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

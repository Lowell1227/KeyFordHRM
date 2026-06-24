import { test, expect } from '@playwright/test';

test.describe('04-template-weight-validation', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  test('invalid dimension weights block UI submit', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.getByTestId('template-create')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('template-create').click();

    // 默认的两个核心维度权重为 0%，页面应立即提示不能提交的权重错误
    await expect(page.locator('.weight-error-inline')).toContainText('权重');
  });
});

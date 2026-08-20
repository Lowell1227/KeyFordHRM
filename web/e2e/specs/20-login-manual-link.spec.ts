import { expect, test } from '@playwright/test';

test.describe('login manual link', () => {
  test('operation manual opens in a new tab without leaving the login page', async ({ page }) => {
    await page.goto('/login');

    const manualLink = page.getByRole('link', { name: '查看系统操作与验收手册' });
    await expect(manualLink).toBeVisible();
    await expect(manualLink).toHaveAttribute('href', '/manual/index.html');
    await expect(manualLink).toHaveAttribute('target', '_blank');

    const [manualPage] = await Promise.all([
      page.waitForEvent('popup'),
      manualLink.click(),
    ]);
    await expect(page).toHaveURL(/\/login$/);
    await expect(manualPage).toHaveURL(/\/manual\/index\.html$/);
    await expect(manualPage).toHaveTitle('孚德绩效管理系统｜操作与验收手册');
  });

  test('login and manual use the official 2025 brand assets', async ({ page }) => {
    await page.goto('/login');

    const loginLogo = page.getByRole('img', { name: 'KAYFORD 孚德' });
    await expect(loginLogo).toBeVisible();
    await expect(loginLogo).toHaveAttribute('src', '/brand/logo-2025.png');
    expect(await loginLogo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

    await page.goto('/manual/index.html');
    const manualLogo = page.getByRole('img', { name: 'KAYFORD 孚德' });
    await expect(manualLogo).toBeVisible();
    await expect(manualLogo).toHaveAttribute('src', '../brand/logo-2025-horizontal-inverse.png');
    expect(await manualLogo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });

  test('authenticated navigation uses the inverse 2025 logo on its blue rail', async ({ page }) => {
    await page.goto('/login');
    const quickLogin = page.getByTestId('test-account-login-button').first();
    await expect(quickLogin).toBeVisible();
    await quickLogin.click();
    await page.waitForURL(/\/dashboard$/);

    const sidebarLogo = page.getByRole('img', { name: 'KAYFORD 孚德' });
    await expect(sidebarLogo).toBeVisible();
    await expect(sidebarLogo).toHaveAttribute('src', '/brand/logo-2025-inverse.png');
    expect(await sidebarLogo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });
});

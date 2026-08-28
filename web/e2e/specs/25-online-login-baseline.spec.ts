import { expect, test } from '@playwright/test';

test.describe('登录页品牌体验', () => {
  test('桌面端使用品牌舞台与登录区双栏布局', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/login');

    const shell = page.getByTestId('login-shell');
    const brand = page.getByTestId('login-brand-panel');
    const auth = page.getByTestId('login-auth-panel');

    await expect(shell).toBeVisible();
    await expect(brand).toBeVisible();
    await expect(auth).toBeVisible();
    await expect(brand.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(auth.getByRole('heading', { level: 2, name: '欢迎登录' })).toBeVisible();

    const layout = await Promise.all([shell, brand, auth].map((locator) => locator.boundingBox()));
    expect(layout.every(Boolean)).toBe(true);
    expect(layout[0]!.width).toBeGreaterThanOrEqual(1000);
    expect(layout[0]!.width).toBeLessThanOrEqual(1160);
    expect(layout[1]!.x).toBeLessThan(layout[2]!.x);
    expect(layout[1]!.x + layout[1]!.width).toBeLessThanOrEqual(layout[2]!.x + 1);

    const primaryButton = page.getByRole('button', { name: '选择钉钉账号/组织登录' });
    const buttonBox = await primaryButton.boundingBox();
    expect(buttonBox?.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('登录说明保持克制层级并将主操作留给钉钉登录', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/login');
    await expect(page.locator('.auth-heading h2')).toBeVisible();

    const hierarchy = await page.evaluate(() => {
      const title = getComputedStyle(document.querySelector('.auth-heading h2')!);
      const eyebrow = getComputedStyle(document.querySelector('.auth-eyebrow')!);
      const subtitle = getComputedStyle(document.querySelector('.auth-heading > p:last-child')!);
      const primaryButton = document.querySelector('.dingtalk-btn')!.getBoundingClientRect();

      return {
        titleSize: Number.parseFloat(title.fontSize),
        titleWeight: Number.parseInt(title.fontWeight, 10),
        eyebrowSize: Number.parseFloat(eyebrow.fontSize),
        subtitleSize: Number.parseFloat(subtitle.fontSize),
        primaryButtonHeight: primaryButton.height,
      };
    });

    expect(hierarchy.titleSize).toBeLessThanOrEqual(27);
    expect(hierarchy.titleWeight).toBeLessThanOrEqual(600);
    expect(hierarchy.eyebrowSize).toBeLessThanOrEqual(11);
    expect(hierarchy.subtitleSize).toBeLessThanOrEqual(13);
    expect(hierarchy.primaryButtonHeight).toBeGreaterThanOrEqual(48);
  });

  test('辅助文字与所在表面保持至少 4.5 比 1 的对比度', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('.auth-option__copy small')).toBeVisible();
    await expect(page.locator('.security-note')).toBeVisible();
    await expect(page.locator('.auth-panel')).toBeVisible();

    const ratios = await page.evaluate(() => {
      const rgb = (value: string) => {
        const parts = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
        return parts.map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
      };
      const contrast = (foreground: Element, background: Element) => {
        const foregroundRgb = rgb(getComputedStyle(foreground).color);
        const backgroundRgb = rgb(getComputedStyle(background).backgroundColor);
        const foregroundLuminance = 0.2126 * foregroundRgb[0] + 0.7152 * foregroundRgb[1] + 0.0722 * foregroundRgb[2];
        const backgroundLuminance = 0.2126 * backgroundRgb[0] + 0.7152 * backgroundRgb[1] + 0.0722 * backgroundRgb[2];
        return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
          / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      };
      const required = (selector: string) => document.querySelector(selector)!;

      return [
        contrast(required('.auth-option__copy small'), required('.auth-panel')),
        contrast(required('.security-note'), required('.auth-panel')),
      ];
    });

    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });

  test('管理员账号输入框提供持久标签与正确的自动填充语义', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('password-login-toggle').click();

    const employeeNo = page.getByLabel('工号', { exact: true });
    const password = page.getByLabel('密码', { exact: true });
    await expect(employeeNo).toBeVisible();
    await expect(employeeNo).toHaveAttribute('autocomplete', 'username');
    await expect(password).toBeVisible();
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  test('手机端隐藏品牌舞台并保持工号登录无横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');

    await expect(page.getByTestId('login-brand-panel')).toBeHidden();
    await expect(page.getByTestId('login-auth-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByTestId('password-login-toggle').click();
    await expect(page.getByTestId('login-employee-no')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

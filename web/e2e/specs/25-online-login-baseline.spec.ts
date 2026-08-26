import { expect, test } from '@playwright/test';

const TEST_ACCOUNTS = [
  { employeeNo: 'ADMIN', name: '测试·系统管理员', sysRole: 'system_admin', roleLabel: '系统管理员' },
  { employeeNo: 'HR001', name: '测试·姚遥', sysRole: 'hr', roleLabel: 'HR 管理员' },
  { employeeNo: 'VP001', name: '测试·李弘', sysRole: 'employee', roleLabel: '最终业务审批场景' },
  { employeeNo: 'MGR001', name: '测试·周强明', sysRole: 'employee', roleLabel: '绩效直属上级场景' },
  { employeeNo: 'EMP001', name: '测试·张辰', sysRole: 'employee', roleLabel: '员工目标审核场景' },
  { employeeNo: 'EMP002', name: '测试·陈铭', sysRole: 'employee', roleLabel: '员工自评场景' },
  { employeeNo: 'EMP003', name: '测试·王敏宁', sysRole: 'employee', roleLabel: '主管评分场景' },
  { employeeNo: 'EMP004', name: '测试·刘扬', sysRole: 'employee', roleLabel: '结果查看场景' },
];

async function mockTestAccounts(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/auth/test-accounts', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'success',
        data: { enabled: true, accounts: TEST_ACCOUNTS },
      }),
    });
  });
}

test.describe('登录页品牌体验', () => {
  test('桌面端使用品牌舞台与登录区双栏布局', async ({ page }) => {
    await mockTestAccounts(page);
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
    await mockTestAccounts(page);
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

  test('验收账号在独立对话层中按双列展示并支持 Esc 关闭', async ({ page }) => {
    await mockTestAccounts(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/login');

    await expect(page.getByRole('dialog', { name: '验收账号登录' })).toHaveCount(0);
    const toggle = page.getByTestId('test-account-login-toggle');
    await toggle.click();

    const dialog = page.getByRole('dialog', { name: '验收账号登录' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('仅用于测试组织与测试数据，不关联钉钉和真实员工');

    const buttons = dialog.getByTestId('test-account-login-button');
    await expect(buttons).toHaveCount(8);
    const cards = await buttons.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      const role = element.querySelector('.quick-login__role');
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        roleFits: !!role && role.scrollWidth <= role.clientWidth,
        cardFits: element.scrollWidth <= element.clientWidth,
      };
    }));

    expect(cards[0].y).toBe(cards[1].y);
    expect(cards[1].x).toBeGreaterThan(cards[0].x);
    expect(cards[2].y).toBeGreaterThan(cards[0].y);
    expect(cards.every((card) => card.roleFits && card.cardFits)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test('辅助文字与所在表面保持至少 4.5 比 1 的对比度', async ({ page }) => {
    await mockTestAccounts(page);
    await page.goto('/login');
    await page.getByTestId('test-account-login-toggle').click();

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
        contrast(required('.quick-login__no'), required('.quick-login__account')),
      ];
    });

    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });

  test('系统偏好减少动态效果时验收弹层不播放进入动画', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockTestAccounts(page);
    await page.goto('/login');
    await page.getByTestId('test-account-login-toggle').click();

    const dialogAnimations = await page.evaluate(() => document.getAnimations()
      .map((animation) => 'animationName' in animation ? String(animation.animationName) : '')
      .filter((name) => name.includes('fade')));

    expect(dialogAnimations).toEqual([]);
  });

  test('管理员账号输入框提供持久标签与正确的自动填充语义', async ({ page }) => {
    await mockTestAccounts(page);
    await page.goto('/login');
    await page.getByTestId('password-login-toggle').click();

    const employeeNo = page.getByLabel('工号', { exact: true });
    const password = page.getByLabel('密码', { exact: true });
    await expect(employeeNo).toBeVisible();
    await expect(employeeNo).toHaveAttribute('autocomplete', 'username');
    await expect(password).toBeVisible();
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  test('手机端隐藏品牌舞台并将验收账号对话层贴底单列显示', async ({ page }) => {
    await mockTestAccounts(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');

    await expect(page.getByTestId('login-brand-panel')).toBeHidden();
    await expect(page.getByTestId('login-auth-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByTestId('test-account-login-toggle').click();
    const dialog = page.getByRole('dialog', { name: '验收账号登录' });
    await expect(dialog).toBeVisible();

    const dialogSurface = dialog.locator('.el-dialog');
    await expect.poll(async () => {
      const box = await dialogSurface.boundingBox();
      return Math.abs((box?.y ?? 0) + (box?.height ?? 0) - 844);
    }).toBeLessThanOrEqual(2);

    const dialogBox = await dialogSurface.boundingBox();
    expect(dialogBox?.width).toBeGreaterThanOrEqual(358);
    expect(Math.abs((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0) - 844)).toBeLessThanOrEqual(2);

    const cards = await dialog.getByTestId('test-account-login-button').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y) };
    }));
    expect(new Set(cards.map((card) => card.x)).size).toBe(1);
    expect(new Set(cards.map((card) => card.y)).size).toBe(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

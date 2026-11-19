import { test, expect } from '@playwright/test';

test('E-HR login keeps performance slogan and browses modules without changing authentication', async ({ page }, info) => {
  await page.clock.install();
  await page.goto('/login');
  await expect(page).toHaveTitle('孚德E-HR');
  await expect(page.locator('.auth-eyebrow')).toHaveText('孚德E-HR');
  const brand = page.getByTestId('login-brand-panel');
  await expect(brand).toBeVisible();
  await expect(brand.getByRole('heading', { level: 1 })).toHaveText('让目标更清晰，让成长被看见');
  await page.mouse.move(0, 0);
  await page.clock.fastForward(6500);
  await expect(brand.getByRole('heading', { level: 1 })).toHaveText('一份员工档案，串起每段任职');
  await expect(brand.getByRole('button', { name: /薪酬/ })).toHaveCount(0);
  await expect(brand.getByRole('button', { name: /暂停轮播|继续轮播/ })).toHaveCount(0);
  await brand.getByRole('button', { name: '员工档案', exact: true }).click();
  await page.mouse.move(0, 0); await brand.getByRole('button', { name: '员工档案', exact: true }).blur();
  await page.clock.fastForward(6500);
  await expect(brand.getByRole('heading', { level: 1 })).toHaveText('从人才储备，到每一次新开始');
  await brand.getByRole('button', { name: '绩效管理', exact: true }).click();
  await expect(brand.getByRole('heading', { level: 1 })).toHaveText('让目标更清晰，让成长被看见');
  await expect(brand.locator('.brand-fade-enter-active, .brand-fade-leave-active')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('ehr-login.png'), fullPage: true, animations: 'disabled' });
  const login = page.getByRole('button', { name: '进入预览', exact: true });
  await expect(login).toBeEnabled(); await login.click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('reduced motion keeps the login carousel manual', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install(); await page.goto('/login');
  const brand = page.getByTestId('login-brand-panel');
  await expect(brand.getByRole('heading', { level: 1 })).toContainText('让目标更清晰');
  await page.clock.fastForward(20000);
  await expect(brand.getByRole('heading', { level: 1 })).toContainText('让目标更清晰');
  await brand.getByRole('button', { name: '员工档案', exact: true }).click();
  await expect(brand.getByRole('heading', { level: 1 })).toContainText('一份员工档案');
});

import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.beforeAll(() => {
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', '-e', `
    require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    if (process.env.DINGTALK_NOTIFICATION_ENABLED !== 'false'
      || process.env.DINGTALK_INTERVIEW_CALENDAR_ENABLED !== 'false'
      || process.env.PAYROLL_FORMAL_ENABLED === 'true') process.exit(1);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
});

async function activate(page: Page, target: ReturnType<Page['getByTestId']>) {
  if (test.info().project.name === 'mobile') await target.tap(); else await target.click();
}

async function login(page: Page, account: 'ADMIN' | 'HR001') {
  await page.goto('/login');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/login');
  await activate(page, page.getByTestId('preview-account'));
  await activate(page, page.getByRole('option').filter({ hasText: `(${account})` }));
  await activate(page, page.getByTestId('preview-login'));
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
}

test('0.9.2 overview is accurate and recruitment/payroll entries use the real isolated backend', async ({ page, context }, info) => {
  const errors: string[] = [], unexpectedWrites: string[] = [];
  page.on('pageerror', error => errors.push(error.name));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://localhost:5173') return route.abort();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && url.pathname !== '/api/v1/auth/test-login') {
      unexpectedWrites.push(url.pathname); return route.abort();
    }
    return route.continue();
  });
  await login(page, 'ADMIN');
  await page.goto('/system');
  await expect(page.getByTestId('system-overview')).toContainText('版本 0.9.2');
  const salary = page.getByTestId('system-capability-status').filter({ hasText: '薪酬核算与独立权限' });
  await expect(salary).toContainText('隔离预览');
  await expect(salary).toContainText('正式算薪未启用');
  await page.goto('/compensation');
  const planning = page.getByTestId('compensation-overview');
  await expect(planning).toContainText('自然月 1 日至月底');
  await expect(planning).toContainText('正式算薪未启用');
  await expect(planning).not.toContainText('尚未立项');
  await expect(planning.locator('button,input,select,textarea')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('salary-status-0.9.2.png'), fullPage: true, animations: 'disabled' });

  await login(page, 'HR001');
  await activate(page, page.getByTestId('nav-module-recruitment'));
  await expect(page).toHaveURL(/\/talents$/);
  await expect(page.getByRole('button', { name: '批量删除', exact: true })).toBeVisible();
  await activate(page, page.getByTestId('nav-module-compensation'));
  await activate(page, page.locator('.menu-panel').getByRole('button', { name: '考勤打卡', exact: true }));
  await expect(page).toHaveURL(/\/payroll\/attendance$/);
  await expect(page.getByRole('button', { name: '接收考勤', exact: true })).toBeVisible();
  await expect(page.getByText('当前账号没有该页面的薪酬主体授权')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(unexpectedWrites).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('payroll-preview-0.9.2.png'), fullPage: true, animations: 'disabled' });
});

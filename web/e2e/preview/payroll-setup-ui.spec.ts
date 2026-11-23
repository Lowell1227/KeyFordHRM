import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const origin = 'http://127.0.0.1:5175';
const menuOrder = ['工资资料', '扣缴资料', '资料审核', '考勤与封账', '试算与核算', '复核与审批', '结果与补差'];
async function control(op: 'create' | 'inspect', input = {}) {
  const response = await fetch(`http://127.0.0.1:3011/__readiness-ui/${op}`, { method: 'POST',
    headers: { 'x-readiness-ui-run': process.env.HRM_READINESS_UI_RUN!, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  expect(response.status).toBe(200); return response.json();
}
async function zeroState(subjectId: string) {
  const value = await control('inspect', { subjectId });
  expect(Object.values(value.emptyState).every(count => count === 0)).toBe(true);
  expect(value.gatewayCalls).toBe(0); expect(value.environmentUnchanged).toBe(true);
}
async function login(page: Page, fixture: any, role: 'hr' | 'reviewer' | 'approver', target: string) {
  await page.goto('/login'); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`/login?redirect=${encodeURIComponent(target)}`); await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('preview-login')).toHaveCount(0);
  await page.getByTestId('password-login-toggle').click();
  await page.getByTestId('login-employee-no').fill(fixture.credentials[role].employeeNo);
  await page.getByTestId('login-password').fill(fixture.credentials[role].password);
  const response = page.waitForResponse(value => value.request().method() === 'POST' && new URL(value.url()).pathname === '/api/v1/auth/login');
  await page.getByTestId('login-submit').click(); expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(new URL(target, origin).href);
}
function assertContext(page: Page, fixture: any, pathname: string, extra = {}) {
  const url = new URL(page.url()); expect(url.pathname).toBe(pathname);
  expect(Object.fromEntries(url.searchParams)).toEqual({ subjectId: fixture.subjectId, month: '2026-10', ...extra });
}
async function screenshot(page: Page, project: string, stage: string) {
  expect(new URL(page.url()).pathname).not.toBe('/login');
  try {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { timeout: 5000 }).toBe(true);
  } catch (error) {
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      poppers: [...document.querySelectorAll('.el-popper')].filter(element => element.getBoundingClientRect().height > 0).map(element => {
        const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width };
      }) }));
    console.log(JSON.stringify({ stage: 'setup-overflow', project, view: stage, geometry }));
    await page.screenshot({ path: path.resolve(`../test-results/payroll-setup-ui/${project}-${stage}-overflow.png`), fullPage: true });
    throw error;
  }
  await page.screenshot({ path: path.resolve(`../test-results/payroll-setup-ui/${project}-${stage}.png`), fullPage: true });
}
async function ownedPage(browser: import('@playwright/test').Browser, use: any) {
  const context = await browser.newContext({ ...use, baseURL: origin });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(), writes: string[] = [], errors: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname !== '/api/v1/auth/login') writes.push(new URL(request.url()).pathname); });
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, writes, errors };
}

test('empty approved payer scope has a clear next step; ordered payroll menus retain October context without carrying drawer queries', async ({ browser }, info) => {
  const fixture = await control('create'), { context, page, writes, errors } = await ownedPage(browser, info.project.use);
  const query = `?subjectId=${fixture.subjectId}&month=2026-10`;
  try {
    await login(page, fixture, 'hr', `/payroll/standards${query}&tab=rules&readiness=list&unrelated=setup-ui`);
    await expect(page.locator('.menu-panel .menu-link')).toHaveText(menuOrder.filter(label => label !== '复核与审批'));
    await expect(page.getByRole('combobox', { name: '发薪公司', exact: true })).toBeVisible();
    const listedJobs = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/payroll/attendance/dingtalk/jobs' && response.request().method() === 'GET'
        && url.searchParams.get('subjectId') === fixture.subjectId && url.searchParams.get('month') === '2026-10';
    });
    await page.getByRole('button', { name: '考勤与封账', exact: true }).click();
    await expect(page).toHaveURL(/\/payroll\/attendance\?/); assertContext(page, fixture, '/payroll/attendance');
    expect((await listedJobs).status()).toBe(200);
    await expect(page.getByText('本月暂无已审核的发薪人员', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '同步钉钉考勤', exact: true })).toBeDisabled();
    await screenshot(page, info.project.name, 'empty-attendance');
    await page.getByRole('button', { name: '试算与核算', exact: true }).click();
    await expect(page).toHaveURL(/\/payroll\/batches\?/); assertContext(page, fixture, '/payroll/batches');
    await page.getByRole('button', { name: '考勤与封账', exact: true }).click();
    await expect(page).toHaveURL(/\/payroll\/attendance\?/); assertContext(page, fixture, '/payroll/attendance');
    await page.getByRole('button', { name: '维护工资规则', exact: true }).click();
    await expect(page).toHaveURL(/\/payroll\/standards\?/); assertContext(page, fixture, '/payroll/standards', { tab: 'rules' });
    await expect(page.getByRole('tab', { name: '工资规则', exact: true })).toHaveAttribute('aria-selected', 'true');
    const candidates = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/payroll/employee-scope-candidates');
    await page.getByRole('button', { name: '新增规则', exact: true }).click();
    expect((await candidates).status()).toBe(200);
    await expect(page.getByRole('dialog', { name: '工资规则草稿', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '工资规则草稿', exact: true })).toContainText('任职记录冲突');
    await screenshot(page, info.project.name, 'rule-draft');
    await page.getByRole('dialog', { name: '工资规则草稿', exact: true }).locator('.el-drawer__close-btn').click();
    for (const role of ['reviewer', 'approver'] as const) {
      await login(page, fixture, role, `/payroll/approvals${query}`);
      await expect(page.locator('.menu-panel .menu-link')).toHaveText(['复核与审批']);
      await expect(page.getByRole('button', { name: '新建核算', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '下载加密工资表', exact: true })).toHaveCount(0);
      await screenshot(page, info.project.name, `${role}-menus`);
    }
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  } finally { await zeroState(fixture.subjectId); await context.close(); }
});

test('candidate dates isolate conflicts; selected conflicts remain removable and cannot be re-added after removal', async ({ browser }, info) => {
  const fixture = await control('create'), { context, page, writes, errors } = await ownedPage(browser, info.project.use);
  try {
    await login(page, fixture, 'hr', `/payroll/standards?subjectId=${fixture.subjectId}&month=2026-10&tab=rules`);
    await page.getByRole('tab', { name: '工资规则', exact: true }).click();
    const requested = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/payroll/employee-scope-candidates');
    await page.getByRole('button', { name: '新增规则', exact: true }).click();
    const response = await requested;
    console.log(JSON.stringify({ stage: 'setup-candidates', project: info.project.name, path: '/api/v1/payroll/employee-scope-candidates', status: response.status() }));
    expect(response.status()).toBe(200);
    const rows = (await response.json()).data;
    expect(!!rows.find((row: any) => row.id === fixture.employeeId && !row.unavailableReason)).toBe(true);
    expect(rows.find((row: any) => row.id === fixture.conflictId)?.unavailableReason).toBeTruthy();
    const drawer = page.getByRole('dialog', { name: '工资规则草稿', exact: true });
    const field = drawer.locator('.el-form-item').filter({ hasText: '本主体发薪人员' });
    await field.locator('.el-select__wrapper').click();
    await field.locator('input.el-select__input').fill(fixture.prefix);
    const healthy = page.getByRole('option').filter({ hasText: fixture.employeeName });
    const conflict = page.getByRole('option').filter({ hasText: fixture.conflictName });
    await expect(healthy).toBeVisible(); await expect(healthy).not.toHaveAttribute('aria-disabled', 'true');
    await expect(conflict).toHaveAttribute('aria-disabled', 'true'); await expect(conflict).toContainText('任职记录冲突');
    await screenshot(page, info.project.name, 'candidate-options');
    await healthy.click(); await expect(field).toContainText(fixture.employeeName);
    await drawer.getByRole('heading', { name: '发薪人员', exact: true }).click();
    async function changeRuleDate(label: string, date: string, expectedFrom: string, expectedTo?: string) {
      const pending = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/v1/payroll/employee-scope-candidates' && url.searchParams.get('subjectId') === fixture.subjectId
          && url.searchParams.get('month') === '2026-10' && url.searchParams.get('effectiveFrom') === expectedFrom
          && url.searchParams.get('effectiveTo') === (expectedTo ?? null);
      });
      const input = drawer.locator('.el-form-item').filter({ hasText: label }).locator('.el-date-editor input');
      await input.fill(date); await input.press('Tab');
      const response = await pending; expect(response.status()).toBe(200); return (await response.json()).data;
    }
    await changeRuleDate('生效日期', '2026-10-01', '2026-10-01');
    const earlyRows = await changeRuleDate('结束日期', '2026-10-10', '2026-10-01', '2026-10-10');
    expect(!!earlyRows.find((row: any) => row.id === fixture.conflictId && !row.unavailableReason)).toBe(true);
    await field.locator('.el-select__wrapper').click(); await field.locator('input.el-select__input').fill(fixture.prefix);
    await expect(conflict).not.toHaveAttribute('aria-disabled', 'true');
    await screenshot(page, info.project.name, 'candidate-early-rule-window');
    await conflict.click();
    const conflictTag = field.locator('.el-tag').filter({ hasText: fixture.conflictName });
    const healthyTag = field.locator('.el-tag').filter({ hasText: fixture.employeeName });
    await expect(conflictTag).toBeVisible(); await expect(healthyTag).toBeVisible();
    await drawer.getByRole('heading', { name: '发薪人员', exact: true }).click();
    const wholeMonthRows = await changeRuleDate('结束日期', '2026-10-31', '2026-10-01', '2026-10-31');
    expect(wholeMonthRows.find((row: any) => row.id === fixture.conflictId)?.unavailableReason).toBeTruthy();
    await field.locator('.el-select__wrapper').click(); await field.locator('input.el-select__input').fill(fixture.prefix);
    await expect(conflictTag).toBeVisible(); await expect(healthyTag).toBeVisible();
    await expect(conflict).not.toHaveAttribute('aria-disabled', 'true');
    await drawer.getByRole('heading', { name: '发薪人员', exact: true }).click();
    await screenshot(page, info.project.name, 'selected-conflict-retained');
    await expect(conflictTag).toBeVisible();
    const removeConflict = conflictTag.locator('.el-tag__close');
    await expect(removeConflict).toBeVisible(); await expect(removeConflict).toBeEnabled();
    await removeConflict.click();
    await expect(conflictTag).toHaveCount(0); await expect(healthyTag).toBeVisible();
    await field.locator('.el-select__wrapper').click(); await field.locator('input.el-select__input').fill(fixture.prefix);
    await expect(conflict).toHaveAttribute('aria-disabled', 'true');
    await expect(conflictTag).toHaveCount(0); await expect(healthyTag).toBeVisible();
    await screenshot(page, info.project.name, 'selected-conflict-removed');
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  } finally { await zeroState(fixture.subjectId); await context.close(); }
});

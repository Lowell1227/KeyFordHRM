import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test.use({ trace: 'off', video: 'off', actionTimeout: 10000, navigationTimeout: 20000 });
const origin = process.env.HRM_PREVIEW_URL ?? 'http://localhost:5173';

async function login(page: import('@playwright/test').Page, employeeNo: string) {
  await page.goto('/login');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByTestId('preview-account').click();
  await page.getByRole('option', { name: new RegExp(`\\(${employeeNo}\\)$`) }).click();
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('administrator maintains grants and audit; revocation removes salary access', async ({ page, browser }, info) => {
  test.setTimeout(120000);
  const fixture = JSON.parse(execFileSync(process.execPath, [path.resolve('../scripts/prepare-payroll-grants-preview.cjs'), info.project.name], { encoding: 'utf8', timeout: 30000 }));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await login(page, 'ADMIN');
  await page.goto('/system/payroll-grants');
  await expect(page.getByTestId('business-list-page')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '新增授权', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增授权', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增薪酬授权', exact: true });
  await drawer.getByRole('button', { name: '保存授权', exact: true }).click();
  await expect(drawer.getByText('请选择公司主体', { exact: true })).toBeVisible();
  await drawer.getByRole('combobox', { name: '授权公司主体' }).click();
  await page.getByRole('option', { name: fixture.subjectName, exact: true }).click();
  await drawer.getByRole('combobox', { name: '授权人员' }).click();
  await page.getByRole('option', { name: `${fixture.userName} · ${fixture.employeeNo}`, exact: true }).click();
  await drawer.locator('label.el-checkbox').filter({ hasText: /^工资查看$/ }).click();
  await expect(drawer.getByRole('checkbox', { name: '工资查看', exact: true })).toBeChecked();
  await drawer.getByRole('textbox', { name: '授权依据', exact: true }).fill('虚构验收：独立工资查看授权');
  await drawer.getByRole('button', { name: '保存授权', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.getByPlaceholder('姓名 / 工号 / 公司').fill(fixture.subjectName);
  const row = info.project.name === 'mobile' ? page.locator('.mobile-result-card').filter({ hasText: fixture.subjectName }) : page.getByRole('row').filter({ hasText: fixture.subjectName });
  await expect(row).toBeVisible();

  const context = await browser.newContext({ viewport: info.project.use.viewport });
  const employee = await context.newPage();
  try {
    await employee.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await login(employee, 'EMP001');
    await employee.goto(`/payroll/batches?subjectId=${fixture.subjectId}&month=2037-01`);
    await expect(employee).toHaveURL(/\/payroll\/batches/);
    await expect(employee.locator('.subject-select')).toContainText(fixture.subjectName);
    await row.getByRole('button', { name: '撤销', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '撤销薪酬权限', exact: true });
    await confirm.getByRole('textbox', { name: '撤销原因' }).fill('虚构验收：办理结束，撤销查看权限');
    await confirm.getByRole('button', { name: '撤销权限', exact: true }).click();
    await expect(confirm).not.toBeVisible();
    await employee.reload();
    // Other run-owned subjects can remain authorized; this exact subject must disappear.
    await expect(employee.locator('.subject-select')).not.toContainText(fixture.subjectName);
    if (/\/payroll\//.test(employee.url())) {
      await employee.locator('.subject-select').click();
      await expect(employee.getByRole('combobox', { name: '发薪公司', exact: true })).toHaveAttribute('aria-expanded', 'true');
      await expect(employee.getByRole('option', { name: fixture.subjectName, exact: true })).toHaveCount(0);
      await employee.keyboard.press('Escape');
    }
    const status = await employee.evaluate(async id => (await fetch(`/api/v1/payroll/batches?subjectId=${id}&month=2037-01`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })).status, fixture.subjectId);
    expect(status).toBe(403);
  } finally { await context.close(); }
  await page.locator('.el-select').filter({ has: page.getByRole('combobox', { name: '授权状态', exact: true }) }).click();
  await page.getByRole('option', { name: '已撤销', exact: true }).click();
  await row.getByRole('button', { name: '记录', exact: true }).click();
  const history = page.getByRole('dialog', { name: '授权记录', exact: true });
  await expect(history.getByText('虚构验收：独立工资查看授权', { exact: true })).toBeVisible();
  await expect(history.getByText('虚构验收：办理结束，撤销查看权限', { exact: true })).toBeVisible();
  if (info.project.name === 'mobile') {
    await expect.poll(async () => Math.round((await history.boundingBox())?.x ?? -1)).toBe(0);
    await expect.poll(async () => Math.round((await history.boundingBox())?.width ?? 0)).toBe(info.project.use.viewport!.width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('grants-audit.png'), fullPage: true });
});

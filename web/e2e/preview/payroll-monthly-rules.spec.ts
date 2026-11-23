import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test.skip(process.env.HRM_PAYROLL_MONTHLY_ACCEPTANCE !== '1', 'Requires the explicitly prepared isolated monthly fixture');
test.use({ trace: 'off', video: 'off', actionTimeout: 15000, navigationTimeout: 20000 });
test.setTimeout(240000);
const root = fileURLToPath(new URL('../../../', import.meta.url));
type Fixture = { fictional: boolean; subjectId: string; month: string; payMonth: string; batchId: string; actors: Record<string, string> };
const fixture = (): Fixture => JSON.parse(execFileSync(process.execPath, ['scripts/prepare-payroll-monthly-preview.cjs', '--inspect'], { cwd: root, encoding: 'utf8', timeout: 30000 }));
async function login(page: Page, actor: string) {
  await page.goto('/login');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/login');
  await page.getByTestId('preview-account').click();
  await page.getByRole('option', { name: new RegExp(`\\(${actor}\\)$`) }).click();
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
const query = (data: Fixture) => `?subjectId=${data.subjectId}&month=${data.month}`;
async function perform(page: Page, name: string, endpoint: string, note?: string) {
  const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(endpoint));
  await page.getByRole('button', { name, exact: true }).click();
  if (note !== undefined) {
    const form = page.locator('.action-form');
    await form.getByLabel('办理意见与依据').fill(note);
    if (name === '作废未付款版本') {
      await form.getByText('已核实此版本尚未付款', { exact: true }).click();
      await expect(form.getByRole('checkbox', { name: '已核实此版本尚未付款' })).toBeChecked();
    }
    await form.getByRole('button', { name, exact: true }).click();
  }
  const result = await response; expect(result.status()).toBe(201);
  return (await result.json()).data;
}

test('monthly calendar, independent salary, return/resubmit and in-review source revision via real pages', async ({ page }, info) => {
  const data = fixture(); expect(data.fictional).toBe(true);
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost:5173' ? route.continue() : route.abort());
  await login(page, 'HR001');
  await page.goto('/payroll/standards' + query(data));
  await page.getByRole('tab', { name: '工资规则', exact: true }).click();
  await page.getByRole('button', { name: '复制草稿', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '工资规则草稿' });
  const calendar = drawer.getByTestId('payroll-work-calendar');
  await expect(calendar.getByRole('checkbox')).toHaveCount(30);
  await expect(calendar).toContainText('整月应出勤：20 天');
  await calendar.getByLabel('日历版本', { exact: true }).fill('');
  let saves = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/payroll/rules') saves++; });
  await drawer.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(calendar).toContainText('请填写日历版本、确认依据'); expect(saves).toBe(0);
  await calendar.getByLabel('日历版本', { exact: true }).fill(`fictional-ui-${info.project.name}-${Date.now()}`);
  await calendar.getByText('21日', { exact: true }).click();
  await expect(calendar.getByRole('checkbox', { name: `${data.month}-21`, exact: true })).toBeChecked();
  await expect(calendar).toContainText('整月应出勤：21 天');
  await calendar.getByText('21日', { exact: true }).click();
  await expect(calendar.getByRole('checkbox', { name: `${data.month}-21`, exact: true })).not.toBeChecked();
  await expect(calendar).toContainText('整月应出勤：20 天');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await calendar.screenshot({ path: `${root}/test-results/payroll-monthly-20261123/calendar-${info.project.name}.png` });
  const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/payroll/rules');
  await drawer.getByRole('button', { name: '保存草稿', exact: true }).click();
  const savedResponse = await saved; expect(savedResponse.status()).toBe(201);
  const ruleDraft = (await savedResponse.json()).data;
  await expect(drawer).toBeHidden();
  expect(saves).toBe(1);

  await page.goto('/payroll/batches' + query(data));
  await page.getByRole('button', { name: '新建核算', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建工资核算' });
  const payMonth = create.getByLabel('发放月', { exact: true });
  await payMonth.fill(data.payMonth); await payMonth.press('Enter');
  await expect(create.locator('.el-select')).toHaveCount(1);
  await create.locator('.el-select').click();
  await page.getByRole('option', { name: '测试环境验收', exact: true }).click();
  const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/payroll/batches');
  await create.getByRole('button', { name: '创建核算批次', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201);
  const id = (await response.json()).data.id as string;
  await expect(page).toHaveURL(new RegExp(`/payroll/batches/${id}`));
  const calculation = await perform(page, '自动核算', '/calculate');
  expect(Number(calculation.versions[0].gross)).toBe(16400);
  const lines = calculation.versions[0].lines as Array<{ employeeId: string; itemCode: string; amount: string }>;
  expect(lines.filter(row => row.itemCode === 'fixed').map(row => Number(row.amount)).sort((a, b) => a - b)).toEqual([4000, 10000]);
  expect(lines.filter(row => row.itemCode === 'performance').map(row => Number(row.amount)).sort((a, b) => a - b)).toEqual([0, 2400]);
  await expect(page.locator('.summary-grid')).toContainText('16400');
  const visibleLines = page.locator(info.project.name === 'mobile' ? '.payroll-lines-mobile' : '.payroll-lines-desktop');
  await expect(visibleLines).toContainText('4000'); await expect(visibleLines).toContainText('2400');
  await perform(page, '提交复核', '/submit');
  await expect(page.locator('.summary-grid')).toContainText('待复核');
  await login(page, 'MGR001');
  await page.goto(`/payroll/approvals/${id}` + query(data));
  await perform(page, '退回经办', '/decide', '虚构验收：核对后重新提交');
  await login(page, 'HR001');
  await page.goto(`/payroll/batches/${id}` + query(data));
  await perform(page, '自动核算', '/calculate');
  await perform(page, '提交复核', '/submit');

  // A reviewed new parameter version must invalidate an in-review salary snapshot.
  await page.goto('/payroll/standards' + query(data));
  await page.getByRole('tab', { name: '工资规则', exact: true }).click();
  const row = info.project.name === 'mobile' ? page.locator('.mobile-result-card').filter({ hasText: `工资规则 · V${ruleDraft.version}` })
    : page.getByRole('row').filter({ has: page.getByRole('cell', { name: String(ruleDraft.version), exact: true }) });
  const submitted = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/rule/${ruleDraft.id}/submit`));
  await row.getByRole('button', { name: '提交主管审核', exact: true }).click();
  const submittedResponse = await submitted; expect(submittedResponse.status()).toBe(201);
  const release = (await submittedResponse.json()).data;
  await expect(page).toHaveURL(/\/payroll\/parameter-reviews/);
  await expect(page.getByRole('button', { name: '启用', exact: true })).toHaveCount(0);
  await login(page, 'MGR001');
  await page.goto('/payroll/parameter-reviews' + query(data));
  const reviewRow = info.project.name === 'mobile' ? page.locator('.mobile-result-card').filter({ hasText: `工资规则 · V${ruleDraft.version}` })
    : page.getByRole('row').filter({ hasText: `工资规则 · V${ruleDraft.version}` });
  await reviewRow.getByRole('button', { name: '审核', exact: true }).click();
  const reviewed = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/${release.id}/decide`));
  await page.getByRole('dialog', { name: '参数审核' }).getByRole('button', { name: '审核并发布', exact: true }).click();
  expect((await reviewed).status()).toBe(201);
  await page.goto(`/payroll/approvals/${id}` + query(data));
  await expect(page.getByRole('alert').filter({ hasText: '来源已更新' })).toBeVisible();
  await expect(page.getByRole('button', { name: '通过当前环节', exact: true })).toHaveCount(0);
  await perform(page, '退回经办', '/decide', '虚构验收：来源版本变化，退回重算');
  await login(page, 'HR001');
  await page.goto(`/payroll/batches/${id}` + query(data));
  await perform(page, '自动核算', '/calculate');
  await expect(page.locator('.summary-grid')).toContainText('16400');
  await perform(page, '提交复核', '/submit');
  await login(page, 'MGR001');
  await page.goto(`/payroll/approvals/${id}` + query(data));
  await perform(page, '通过当前环节', '/decide', '虚构独立复核通过');
  await login(page, 'VP001');
  await page.goto(`/payroll/approvals/${id}` + query(data));
  await perform(page, '通过当前环节', '/decide', '虚构审批通过，不代表实际付款');
  await expect(page.locator('.summary-grid')).toContainText('已批准');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `${root}/test-results/payroll-monthly-20261123/approved-${info.project.name}.png`, fullPage: true });
  await perform(page, '作废未付款版本', '/void', '虚构页面验收结束，未付款');
  await login(page, 'HR001');
  await page.goto(`/payroll/batches/${data.batchId}` + query(data));
  await perform(page, '自动核算', '/calculate');
  await expect(page.locator('.summary-grid')).toContainText('16400');
  await expect(page.getByRole('button', { name: '提交复核', exact: true })).toHaveCount(0);
});

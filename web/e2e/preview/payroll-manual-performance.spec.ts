import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

test.skip(process.env.HRM_PAYROLL_MANUAL_ACCEPTANCE !== '1', 'Requires owned fictional manual payroll fixtures and the matching preview backend');
test.use({ trace: 'off', video: 'off', actionTimeout: 15000, navigationTimeout: 20000 });
test.setTimeout(240000);
const root = fileURLToPath(new URL('../../../', import.meta.url));

async function login(page: Page, actor: string) {
  await page.goto('/login'); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await page.goto('/login');
  await page.getByTestId('preview-account').click();
  await page.getByRole('option', { name: new RegExp(`\\(${actor}\\)$`) }).click();
  await page.getByTestId('preview-login').click(); await expect(page).toHaveURL(/\/dashboard$/);
}
async function post(page: Page, suffix: string, action: () => Promise<unknown>) {
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(suffix));
  await action(); const response = await pending; expect(response.status()).toBe(201); return (await response.json()).data;
}

test('HR monthly manual wages, direct-manager return/resubmit, independent payroll approvals and protected export without actual payment', async ({ page }, info) => {
  const data = JSON.parse(execFileSync(process.execPath, ['scripts/prepare-payroll-net-preview.cjs', `net-manual-${info.project.name}`, '--inspect'], { cwd: root, encoding: 'utf8', timeout: 30000 }));
  expect(data.fictional).toBe(true); expect(data.month).toBe('2037-01'); expect(data.payDate).toBe('2037-02-10');
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost:5173' ? route.continue() : route.abort());
  const query = `?subjectId=${data.subjectId}&month=${data.month}`;
  const ruleRow = (version: number) => info.project.name === 'mobile'
    ? page.locator('.mobile-result-card').filter({ hasText: `工资规则 · V${version}` })
    : page.getByRole('row').filter({ has: page.getByRole('cell', { name: String(version), exact: true }) });
  const reviewRow = (version: number) => page.locator(info.project.name === 'mobile' ? '.mobile-result-card' : 'tr.el-table__row').filter({ hasText: `工资规则 · V${version}` });
  await login(page, 'HR001'); await page.goto('/payroll/standards' + query);
  await page.getByRole('tab', { name: '工资规则', exact: true }).click();
  await page.getByRole('button', { name: '复制草稿', exact: true }).first().click();
  const form = page.getByRole('dialog', { name: '工资规则草稿', exact: true });
  const manual = form.getByTestId('payroll-manual-performance');
  const amount = manual.getByTestId(`payroll-manual-amount-${data.employeeId}`);
  await expect(manual).toContainText('参数样例（虚构）'); await expect(amount).toHaveValue('0.00');
  await expect(form.getByLabel('绩效周期', { exact: true })).toHaveCount(0);
  await expect(form.getByLabel('统一系数表版本', { exact: true })).toHaveCount(0);
  await amount.fill('1.234');
  await form.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(manual.locator('.el-form-item').filter({ has: page.getByTestId(`payroll-manual-amount-${data.employeeId}`) })).toContainText('最多12位整数、2位小数');
  await amount.fill(''); await expect(amount).toHaveValue('');
  await manual.getByLabel('绩效工资确认依据', { exact: true }).fill('');
  await form.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(manual.locator('.el-form-item').filter({ has: page.getByLabel('绩效工资确认依据', { exact: true }) })).toContainText('请填写绩效工资确认依据');
  await amount.fill('1234.56');
  await manual.getByLabel('绩效工资确认依据', { exact: true }).fill('虚构HR确认：本月绩效工资1234.56元，不按入离职自动折算');
  await form.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog', { name: '离开编辑', exact: true }).getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(amount).toHaveValue('1234.56');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await manual.screenshot({ path: info.outputPath(`manual-entry-${info.project.name}.png`), animations: 'disabled' });
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(amount).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await manual.screenshot({ path: info.outputPath('manual-entry-tablet.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  const draft = await post(page, '/payroll/rules', () => form.getByRole('button', { name: '保存草稿', exact: true }).click());
  expect(draft.config.performance[data.month]).toEqual({ sourceKind: 'manual', manualAmounts: { [data.employeeId]: '1234.56' }, evidenceRef: '虚构HR确认：本月绩效工资1234.56元，不按入离职自动折算', cycleIds: [], coefficients: {} });
  const first = await post(page, `/${draft.id}/submit`, () => ruleRow(draft.version).getByRole('button', { name: '提交主管审核', exact: true }).click());
  expect(first.reviewerId).toBe(data.actors.MGR001); expect(first.submittedById).toBe(data.actors.HR001);
  await expect(page).toHaveURL(/\/payroll\/parameter-reviews/);
  await reviewRow(draft.version).getByRole('button', { name: '查看', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '参数审核', exact: true });
  await expect(detail.getByRole('button', { name: '审核并发布', exact: true })).toHaveCount(0);
  await login(page, 'MGR001'); await page.goto('/payroll/parameter-reviews' + query);
  await reviewRow(draft.version).getByRole('button', { name: '审核', exact: true }).click();
  await expect(detail.getByTestId('payroll-manual-review')).toContainText('参数样例（虚构）');
  await expect(detail.getByTestId('payroll-manual-review')).toContainText('1234.56');
  await expect(detail).not.toContainText('绩效系数');
  await detail.getByRole('button', { name: '退回修改', exact: true }).click();
  await expect(detail).toContainText('请填写办理原因');
  await detail.getByLabel('办理意见', { exact: true }).fill('虚构主管核对：确认后重新提交');
  await post(page, `/${first.id}/decide`, () => detail.getByRole('button', { name: '退回修改', exact: true }).click());
  await expect(detail).toContainText('已退回');
  await login(page, 'HR001'); await page.goto('/payroll/standards' + query);
  await page.getByRole('tab', { name: '工资规则', exact: true }).click();
  const second = await post(page, `/${draft.id}/submit`, () => ruleRow(draft.version).getByRole('button', { name: '提交主管审核', exact: true }).click());
  expect(second.attempt).toBe(first.attempt + 1);
  await login(page, 'MGR001'); await page.goto('/payroll/parameter-reviews' + query);
  await reviewRow(draft.version).getByRole('button', { name: '审核', exact: true }).click();
  await page.reload(); await expect(detail.getByTestId('payroll-manual-review')).toContainText('1234.56');
  await detail.getByLabel('办理意见', { exact: true }).fill('虚构主管确认当月绩效金额');
  await post(page, `/${second.id}/decide`, () => detail.getByRole('button', { name: '审核并发布', exact: true }).click());
  await expect(detail).toContainText('已发布');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await detail.screenshot({ path: info.outputPath(`manual-manager-review-${info.project.name}.png`), animations: 'disabled' });
  await login(page, 'HR001'); await page.goto(`/payroll/batches/${data.batchId}` + query);
  await page.getByText('含扣缴实发', { exact: true }).click();
  await page.getByRole('button', { name: '核算', exact: true }).click();
  await page.getByLabel('核算发薪日', { exact: true }).fill(data.payDate);
  let batch = await post(page, '/calculate', () => page.locator('.action-form').getByRole('button', { name: '核算', exact: true }).click());
  expect(batch.versions[0].gross).toBe('11234.56');
  expect(batch.versions[0].lines.find((line: { itemCode: string }) => line.itemCode === 'performance').amount).toBe('1234.56');
  expect(batch.versions[0].netSnapshot.totals).toEqual({ gross: '11234.56', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '1103.46', net: '9931.10' });
  await expect(page.getByTestId('payroll-net-total-net')).toHaveText('9931.10');
  await post(page, '/submit', () => page.getByRole('button', { name: '提交复核', exact: true }).click());
  for (const actor of ['MGR001', 'VP001']) {
    await login(page, actor); await page.goto(`/payroll/approvals/${data.batchId}` + query);
    await page.getByRole('button', { name: '通过当前环节', exact: true }).click();
    await page.getByLabel('办理意见与依据', { exact: true }).fill(`虚构${actor === 'MGR001' ? '复核' : '审批'}：绩效金额与扣缴核对通过`);
    batch = await post(page, '/decide', () => page.locator('.action-form').getByRole('button', { name: '通过当前环节', exact: true }).click());
  }
  expect(batch.status).toBe('approved'); expect(batch.versions[0].netPayments).toHaveLength(0);
  await page.goto(`/payroll/results/${data.batchId}` + query);
  await expect(page.getByTestId('payroll-net-total-net')).toHaveText('9931.10');
  await page.getByRole('button', { name: '下载加密工资表', exact: true }).click();
  await page.getByLabel('Excel 独立文件密码', { exact: true }).fill(randomBytes(16).toString('hex'));
  const downloading = page.waitForEvent('download');
  await page.locator('.action-form').getByRole('button', { name: '下载加密工资表', exact: true }).click();
  const file = await downloading; expect(file.suggestedFilename()).toContain('测试环境-实发工资'); expect(await file.failure()).toBeNull(); await file.delete();
  await expect(page.getByRole('button', { name: '确认实发与扣缴', exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath(`manual-approved-unpaid-${info.project.name}.png`), fullPage: true, animations: 'disabled' });
});

test('approved manual snapshots remain readable after the final source-guard update', async ({ page }, info) => {
  const data = JSON.parse(execFileSync(process.execPath, ['scripts/prepare-payroll-net-preview.cjs', `net-manual-${info.project.name}`, '--inspect'], { cwd: root, encoding: 'utf8', timeout: 30000 }));
  expect(data.fictional).toBe(true);
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost:5173' ? route.continue() : route.abort());
  await login(page, 'VP001');
  const response = page.waitForResponse(value => value.request().method() === 'GET'
    && new URL(value.url()).pathname === `/api/v1/payroll/batches/${data.batchId}`);
  await page.goto(`/payroll/results/${data.batchId}?subjectId=${data.subjectId}&month=${data.month}`);
  expect((await response).status()).toBe(200);
  const batch = (await (await response).json()).data;
  expect(batch.status).toBe('approved'); expect(batch.versions[0].needsUpdate).toBe(false);
  expect(batch.versions[0].netPayments).toHaveLength(0);
  await expect(page.getByTestId('payroll-net-total-net')).toHaveText('9931.10');
  await expect(page.getByRole('button', { name: '下载加密工资表', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`manual-final-readonly-${info.project.name}.png`), fullPage: true, animations: 'disabled' });
});

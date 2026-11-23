import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test.skip(process.env.HRM_PAYROLL_PARAMETER_ACCEPTANCE !== '1', 'Requires isolated fictional parameter fixtures');
test.use({ trace: 'off', video: 'off', actionTimeout: 15000, navigationTimeout: 20000 });
test.setTimeout(180000);
const root = fileURLToPath(new URL('../../../', import.meta.url));
async function login(page: Page, actor: string) {
  await page.goto('/login'); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await page.goto('/login');
  await page.getByTestId('preview-account').click();
  await page.getByRole('option', { name: new RegExp(`\\(${actor}\\)$`) }).click();
  await page.getByTestId('preview-login').click(); await expect(page).toHaveURL(/\/dashboard$/);
}
async function post(page: Page, suffix: string, action: () => Promise<unknown>) {
  const waiting = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(suffix));
  await action(); const response = await waiting; expect(response.status()).toBe(201); return (await response.json()).data;
}

test('HR entry, own manager review, return/resubmit, future publication and withdrawal through real pages', async ({ page }, info) => {
  const scope = info.project.name;
  const data = JSON.parse(execFileSync(process.execPath, ['scripts/prepare-payroll-parameter-preview.cjs', scope, '--inspect'], { cwd: root, encoding: 'utf8', timeout: 30000 }));
  expect(data.fictional).toBe(true);
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost:5173' ? route.continue() : route.abort());
  const query = `?subjectId=${data.subjectId}&month=${data.month}`;
  const record = (version: number, review = false) => info.project.name === 'mobile'
    ? page.locator('.mobile-result-card').filter({ hasText: `参数样例（虚构） · V${version}` })
    : review ? page.getByRole('row').filter({ hasText: `参数样例（虚构） · V${version}` })
    : page.getByRole('row').filter({ has: page.getByRole('cell', { name: String(version), exact: true }) });
  await login(page, 'HR001'); await page.goto('/payroll/standards' + query);
  await page.getByRole('button', { name: '复制草稿', exact: true }).first().click();
  const form = page.getByRole('dialog', { name: '工资标准草稿', exact: true });
  await form.getByLabel('生效日期', { exact: true }).fill('2037-02-01'); await form.getByLabel('生效日期', { exact: true }).press('Enter');
  await form.getByLabel('结束日期', { exact: true }).fill('2037-02-28'); await form.getByLabel('结束日期', { exact: true }).press('Enter');
  await form.getByLabel('固定月标准', { exact: true }).fill('12000');
  await form.getByLabel('确认依据', { exact: true }).fill('虚构调薪确认依据：未来月份使用新标准');
  const draft = await post(page, '/payroll/standards', () => form.getByRole('button', { name: '保存草稿', exact: true }).click());
  await expect(form).toBeHidden();
  const first = await post(page, `/${draft.id}/submit`, () => record(draft.version).getByRole('button', { name: '提交主管审核', exact: true }).click());
  expect(first.reviewerId).toBe(data.actors.MGR001); expect(first.submittedById).toBe(data.actors.HR001);
  await expect(page).toHaveURL(/\/payroll\/parameter-reviews/);
  await record(draft.version, true).getByRole('button', { name: '查看', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '参数审核', exact: true });
  await expect(detail).toContainText('12000'); await expect(detail).toContainText('2037-02-01');
  await expect(detail.getByRole('button', { name: '审核并发布', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await login(page, 'MGR001'); await page.goto('/payroll/parameter-reviews' + query);
  await record(draft.version, true).getByRole('button', { name: '审核', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`releaseId=${first.id}`));
  await page.reload(); await expect(detail).toBeVisible();
  await expect(detail).toContainText('虚构调薪确认依据');
  await detail.getByRole('button', { name: '退回修改', exact: true }).click();
  await expect(detail).toContainText('请填写办理原因');
  await detail.getByLabel('办理意见', { exact: true }).fill('虚构核对：补充确认后重提');
  await post(page, `/${first.id}/decide`, () => detail.getByRole('button', { name: '退回修改', exact: true }).click());
  await expect(detail).toContainText('已退回'); await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await login(page, 'HR001'); await page.goto('/payroll/standards' + query);
  const second = await post(page, `/${draft.id}/submit`, () => record(draft.version).getByRole('button', { name: '提交主管审核', exact: true }).click());
  expect(second.attempt).toBe(first.attempt + 1);
  await login(page, 'MGR001'); await page.goto('/payroll/parameter-reviews' + query);
  await record(draft.version, true).getByRole('button', { name: '审核', exact: true }).click();
  await detail.getByLabel('办理意见', { exact: true }).fill('虚构主管确认：按新版本日期生效');
  await post(page, `/${second.id}/decide`, () => detail.getByRole('button', { name: '审核并发布', exact: true }).click());
  await expect(detail).toContainText('已发布');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `${root}/test-results/payroll-parameters-20261123/published-${scope}.png`, fullPage: true });
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await login(page, 'HR001'); await page.goto(`/payroll/batches/${data.batchId}` + query);
  const calculated = await post(page, '/calculate', () => page.getByRole('button', { name: '自动核算', exact: true }).click());
  expect(Number(calculated.versions[0].gross)).toBe(10000); // Future version cannot alter January.
  await page.goto('/payroll/standards' + query);
  await expect(page.getByRole('button', { name: '启用', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停用', exact: true })).toHaveCount(0);
  await record(draft.version).getByRole('button', { name: '复制草稿', exact: true }).click();
  const withdrawalDraft = await post(page, '/payroll/standards', () => form.getByRole('button', { name: '保存草稿', exact: true }).click());
  const withdrawal = await post(page, `/${withdrawalDraft.id}/submit`, () => record(withdrawalDraft.version).getByRole('button', { name: '提交主管审核', exact: true }).click());
  await record(withdrawalDraft.version, true).getByRole('button', { name: '查看', exact: true }).click();
  await detail.getByLabel('办理意见', { exact: true }).fill('虚构验收：经办撤回，暂不发布');
  await post(page, `/${withdrawal.id}/withdraw`, () => detail.getByRole('button', { name: '撤回申请', exact: true }).click());
  await expect(detail).toContainText('已撤回');
});

test.describe('tablet parameter details', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  test('calendar inspection, direct link and browser back', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'One tablet pass, not a duplicate phone pass');
    const data = JSON.parse(execFileSync(process.execPath, ['scripts/prepare-payroll-parameter-preview.cjs', 'demo', '--inspect'], { cwd: root, encoding: 'utf8', timeout: 30000 }));
    await login(page, 'MGR001');
    await page.goto(`/payroll/parameter-reviews?subjectId=${data.subjectId}&month=${data.month}`);
    await page.getByText('近期记录', { exact: true }).click();
    await page.getByRole('row').filter({ hasText: '工资规则 · V1' }).getByRole('button', { name: '查看', exact: true }).click();
    const detail = page.getByRole('dialog', { name: '参数审核', exact: true });
    await expect(detail).toContainText('2037-01 工作日日历 · 20天');
    await page.reload(); await expect(detail).toBeVisible();
    await expect(detail).toContainText('虚构日历，非真实排班');
    await detail.getByText('完整参数', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${root}/test-results/payroll-parameters-20261123/rule-tablet.png`, fullPage: true });
    await page.goBack(); await expect(detail).toBeHidden();
  });
});

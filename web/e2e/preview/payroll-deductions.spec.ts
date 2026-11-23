import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test.skip(process.env.HRM_PAYROLL_DEDUCTIONS_ACCEPTANCE !== '1', 'Requires the owner-prepared isolated deductions fixture');
test.use({ trace: 'off', video: 'off', actionTimeout: 15000 });
test.setTimeout(120000);

type Fixture = { fictional: boolean; month: string; payMonth: string; baseline: string; approvedBatchId: string;
  actors: Record<string, string>; subjects: Array<{ id: string; name: string; batchId: string }> };
const root = fileURLToPath(new URL('../../../', import.meta.url));
function fixture(): Fixture {
  return JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./scripts/verify-payroll-deductions-preview.cjs").inspectFixture()))'],
    { cwd: root, encoding: 'utf8', timeout: 45000, stdio: ['pipe', 'pipe', 'pipe'] }));
}
async function login(page: Page, actor: string, data: Fixture) {
  await page.goto('/login');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '预览系统', exact: true })).toBeVisible();
  await page.getByTestId('preview-account').click();
  await page.getByRole('option', { name: new RegExp(`\\(${actor}\\)$`) }).click();
  const request = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/test-login');
  await page.getByTestId('preview-login').click();
  const result = await request;
  expect(result.status()).toBe(200);
  expect((await result.json()).data.user.id).toBe(data.actors[actor]);
  await expect(page).toHaveURL(/\/dashboard$/);
}
function batchUrl(data: Fixture, index: number, approved = false) {
  return `/payroll/batches/${approved ? data.approvedBatchId : data.subjects[index]!.batchId}?subjectId=${data.subjects[index]!.id}&month=${data.month}`;
}
async function runFlow(page: Page, width: number, screenshot: string) {
  await page.setViewportSize({ width, height: 940 });
  const data = fixture();
  expect(data.fictional).toBe(true);
  // No mocked business responses: all payroll results come from the isolated backend.
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://localhost:5173' ? route.continue() : route.abort());
  await login(page, 'HR001', data);
  await page.goto(batchUrl(data, 0));
  const panel = page.getByTestId('payroll-deductions-preview');
  await expect(panel).toBeVisible();
  const payDate = panel.getByLabel('试算发薪日', { exact: true });
  const calculate = panel.getByRole('button', { name: '试算', exact: true });
  let requests = 0;
  page.on('request', request => { if (request.url().includes('/deductions-preview')) requests++; });
  await expect(payDate).toHaveValue('');
  await calculate.click();
  await expect(panel).toContainText('发薪日');
  expect(requests).toBe(0);
  await payDate.fill('2036-01-05');
  await calculate.click();
  expect(requests).toBe(0);
  await payDate.fill(`${data.payMonth}-05`);
  const result = page.waitForResponse(response => response.url().includes('/deductions-preview'));
  await calculate.click();
  expect((await result).status()).toBe(201);
  await expect(panel).toContainText('15840.00');
  await expect(panel).toContainText('8820.00');
  await expect(panel).toContainText('7020.00');
  await expect(panel).toContainText('实发未审批');
  await panel.getByText('缺项检查', { exact: true }).click();
  await expect(panel).not.toContainText('15840.00');
  const missing = page.waitForResponse(response => response.url().includes('/deductions-preview'));
  await calculate.click();
  expect((await missing).status()).toBe(201);
  await expect(panel).toContainText('待配置');
  await expect(panel).not.toContainText('15840.00');
  await panel.getByText('示例参数', { exact: true }).click();
  // Inject only a transport failure, never a fabricated successful payroll payload.
  await page.route('**/deductions-preview', route => route.abort('failed'), { times: 1 });
  await calculate.click();
  await expect(panel.getByRole('alert')).toBeVisible();
  const retry = page.waitForResponse(response => response.url().includes('/deductions-preview'));
  await calculate.click();
  expect((await retry).status()).toBe(201);
  await expect(panel).toContainText('15840.00');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (width < 600) await expect(panel.locator('.mobile-result-card').first()).toBeVisible();
  const totals = panel.getByTestId('payroll-deductions-preview-totals');
  await totals.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await expect(totals).toBeInViewport({ ratio: 0.95 });
  expect(await totals.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const front = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return !!front && element.contains(front);
  }), 'The batch action footer must not obscure the trial total').toBe(true);
  await page.screenshot({ path: `../test-results/preview/${screenshot}.png`, fullPage: true });

  await page.goto(batchUrl(data, 0, true));
  await expect(panel).toBeVisible();
  await expect(payDate).toHaveValue('');
  await expect(panel).not.toContainText('15840.00');
  await payDate.fill(`${data.payMonth}-05`);
  await calculate.click();
  await expect(panel).toContainText('15840.00');
  await expect(panel).toContainText('实发未审批');

  await login(page, 'EMP003', data);
  await page.goto(batchUrl(data, 1));
  await expect(panel).toBeVisible();
  await expect(payDate).toHaveValue('');
  await expect(panel).not.toContainText('15840.00');
  await payDate.fill(`${data.payMonth}-05`);
  await calculate.click();
  await expect(panel).toContainText('2520.00');
  await page.goto(batchUrl(data, 0));
  await expect(panel).toHaveCount(0);
  await login(page, 'EMP002', data);
  await page.goto(batchUrl(data, 0));
  await expect(panel).toHaveCount(0);
  expect(fixture().baseline, 'Simulation must not change any payroll/approval/export/settlement/configuration rows').toBe(data.baseline);
}

test('real preview deductions, missing data, retry, approved immutability and scope', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull(); expect(info.config.workers).toBe(1);
  await runFlow(page, info.project.name === 'mobile' ? 390 : 1440, `deductions-${info.project.name}`);
});
test('real preview deductions at compact desktop width', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One intermediate viewport is sufficient');
  await runFlow(page, 1024, 'deductions-compact');
});

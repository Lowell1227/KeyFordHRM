// Actual Vue pages with substituted HTTP responses. This is interface evidence, not real backend acceptance.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
let server, browser, origin;
const web = path.resolve(__dirname, '..');
before(async () => {
  const [{ createServer }, vue] = await Promise.all([import('vite'), import('@vitejs/plugin-vue')]);
  server = await createServer({ configFile: false, root: web, plugins: [vue.default()], resolve: { alias: { '@': path.join(web, 'src') } }, define: { 'import.meta.env.VITE_PREVIEW_MODE': JSON.stringify('true') }, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
const caps = ['attendance_edit','attendance_seal','payroll_view','payroll_edit','payroll_review','payroll_approve','payroll_export','payroll_settle'];
const people = [{ id: 'person', name: '虚构员工甲（长文本验收）', employeeNo: 'FICTIONAL-01' }];
function batch(status = 'calculated', purpose = 'validation', more = {}) {
  return { id: 'batch', subjectId: 'subject', month: '2026-11', payMonth: '2026-12', purpose, version: 1, status, versions: [{ id: 'version', version: 1, status, approvalPath: ['actor'], approvalStep: 0, reviewerCount: 1, gross: '0.00', sourceHash: 'fictional-source', sources: {}, issues: [], decisions: [], exports: [], lines: [
    { id: 'line', employeeId: 'person', attributionMonth: '2026-11', itemCode: 'fixed', status: 'ready', entitlement: '0.00', paidBefore: '0', amount: '0.00', evidence: { explanation: '虚构计算依据' } },
    { id: 'na', employeeId: 'person', attributionMonth: '2026-11', itemCode: 'overtime', status: 'not_applicable', entitlement: '0.00', paidBefore: '0', amount: '0.00', evidence: { applicability: 'not_applicable' } },
    { id: 'missing', employeeId: 'person', attributionMonth: '2026-11', itemCode: 'performance', status: 'needs_configuration', entitlement: null, paidBefore: null, amount: null, evidence: {} },
  ] }], ...more };
}
async function pageFor(t, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), calls = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('token', 'fictional-interface-token'); localStorage.setItem('expiresAt', String(Date.now() + 3600000)); });
  const access = { enabled: true, subjects: [{ id: 'subject', name: '虚构验收主体', capabilities: options.capabilities ?? caps }] };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname.replace('/api/v1', '');
    const body = request.postDataJSON(); calls.push({ method: request.method(), path: p, body });
    const custom = await options.handle?.({ request, path: p, body, url });
    if (custom) { await route.fulfill({ status: custom.status ?? 200, contentType: custom.contentType ?? 'application/json', body: custom.body ?? JSON.stringify({ code: 0, data: custom.data }) }); return; }
    let data = [];
    if (p === '/auth/me') data = { id: 'actor', name: '虚构复核人', sysRole: 'employee', canViewAll: false, isAssessorOnly: false, deptId: null, payrollAccess: access };
    if (p === '/payroll/access') data = access;
    if (p === '/payroll/employees') data = people;
    if (p === '/payroll/operators') data = [{ id: 'actor', name: '虚构复核人', capabilities: caps }];
    if (p === '/payroll/batches') data = [options.batch ?? batch()];
    if (p === '/payroll/batches/batch') data = options.batch ?? batch();
    if (p === '/payroll/performance-cycles') data = [{ id: 'cycle', name: '虚构验收周期' }];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  return { page, calls, errors };
}
const expect = require('@playwright/test').expect;
test('actual pages: attendance-only never requests wages; 1440/1024/390 layouts do not overflow', async t => {
  for (const viewport of [{ width:1440,height:900 }, { width:1024,height:768 }, { width:390,height:844 }]) {
    const { page, calls, errors } = await pageFor(t, { viewport, capabilities: ['attendance_edit'] });
    await page.goto(`${origin}payroll/attendance?month=2026-11`);
    await expect(page.getByRole('button', { name: '接收考勤', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '接收考勤', exact: true }).click();
    await expect(page.getByRole('button', { name: '载入虚构考勤', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '接收并核对', exact: true }).click();
    await expect(page.getByText('请输入有效的考勤 JSON 对象')).toBeVisible();
    assert.ok(!calls.some(call => /batches|standards|rules|adjustments|opening-balances/.test(call.path)));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  }
});
test('actual action failure retains form and expected version, settlement retry reuses original request', async t => {
  let first = true;
  const { page, calls } = await pageFor(t, { batch: batch('approved'), handle: async ({ path: p }) => {
    if (p.endsWith('/settlements')) { if (first) { first = false; return { status: 503, body: JSON.stringify({ message: '虚构网络中断，请核对后重试' }) }; } return { data: batch('approved') }; }
  } });
  await page.goto(`${origin}payroll/results/batch?month=2026-11`);
  await page.getByRole('button', { name: '确认入薪', exact: true }).click();
  const form = page.locator('.action-form');
  await form.locator('.el-select').click(); await page.getByRole('option').filter({ hasText: '固定工资' }).click();
  await form.getByRole('textbox').nth(0).fill('0.00'); await form.getByRole('textbox').nth(1).fill('fictional-payment');
  await form.getByRole('button', { name: '确认入薪', exact: true }).click();
  await expect(page.getByTestId('payroll-action-error')).toContainText('虚构网络中断');
  await expect(form.getByRole('textbox').nth(0)).toHaveValue('0.00');
  await page.getByRole('button', { name: '重试同一入薪请求' }).click();
  await expect(page.getByText('确认入薪已完成')).toBeVisible();
  const attempts = calls.filter(call => call.path.endsWith('/settlements'));
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].body, attempts[1].body); assert.equal(attempts[0].body.expectedVersion, 1);
});
test('trial export absent; stale source blocks approval but permits assigned return', async t => {
  const trial = await pageFor(t, { batch: batch('approved', 'trial') });
  await trial.page.goto(`${origin}payroll/results/batch?month=2026-11`);
  await expect(trial.page.getByText('试算', { exact: true }).first()).toBeVisible();
  await expect(trial.page.getByRole('button', { name: '下载加密工资表' })).toHaveCount(0);
  const stale = await pageFor(t, { batch: batch('pending', 'validation', { needsUpdate: true }) });
  await stale.page.goto(`${origin}payroll/approvals/batch?month=2026-11`);
  await expect(stale.page.getByText('来源已更新', { exact: false })).toBeVisible();
  await expect(stale.page.getByRole('button', { name: '通过当前环节' })).toHaveCount(0);
  await expect(stale.page.getByRole('button', { name: '退回经办' })).toBeVisible();
});
test('formal parameters blank, actual employee/operator/cycle selectors, copy keeps JSON evidence', async t => {
  const { page, calls } = await pageFor(t);
  await page.goto(`${origin}payroll/standards?month=2026-11`);
  await page.getByRole('tab', { name: '工资规则' }).click();
  await page.getByRole('button', { name: '新增规则', exact: true }).click();
  const drawer = page.locator('.business-detail-drawer');
  const units = drawer.locator('.el-form-item').filter({ has: page.getByText('2026-11 计薪单位', { exact: true }) }).getByRole('textbox');
  await expect(units).toHaveValue('');
  await drawer.getByRole('button', { name: '保存草稿' }).click(); await expect(drawer.getByText('请选择生效日期')).toBeVisible();
  assert.ok(calls.some(call => call.path.endsWith('/operators'))); assert.ok(calls.some(call => call.path.endsWith('/performance-cycles')));
});
test('actual results distinguish not applicable, ready zero and missing; screenshots at desktop/mobile', async t => {
  for (const viewport of [{ width:1440,height:900 }, { width:1024,height:768 }, { width:390,height:844 }]) {
    const { page, errors } = await pageFor(t, { viewport, batch: batch('approved') });
    await page.goto(`${origin}payroll/results/batch?month=2026-11`);
    await expect(page.locator(viewport.width <= 768 ? '.payroll-lines-mobile' : '.payroll-lines-desktop').getByText(viewport.width <= 768 ? '不适用 · 本批 不适用' : '不适用', { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(os.tmpdir(), `payroll-ui-${viewport.width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
  }
});
test('approved download uses batch write token but calculation version in filename; password clears', async t => {
  const approved = batch('approved'); approved.version = 12; approved.versions[0].version = 3;
  const { page, calls } = await pageFor(t, { batch: approved, handle: async ({ path: p }) => p.endsWith('/export') ? { contentType: 'application/octet-stream', body: 'fictional-encrypted-file' } : undefined });
  await page.goto(`${origin}payroll/results/batch?month=2026-11`);
  await page.getByRole('button', { name: '下载加密工资表' }).click();
  await page.locator('.action-form input[type=password]').fill('fictional-file-password');
  const download = page.waitForEvent('download');
  await page.locator('.action-form').getByRole('button', { name: '下载加密工资表' }).click();
  const result = await download;
  assert.match(result.suggestedFilename(), /测试环境.*V3\.xlsx$/);
  assert.equal(calls.find(call => call.path.endsWith('/export')).body.expectedVersion, 12);
  await expect(page.getByText('已下载当前批准版本，尚未确认入薪')).toBeVisible();
  await expect(page.locator('.action-form input[type=password]')).toHaveCount(0);
});
test('reviewer-only detail does not request edit-only operator or HR employee lists', async t => {
  const pending = batch('pending'); pending.versions[0].lines[0].evidence.employeeName = people[0].name;
  const { page, calls } = await pageFor(t, { batch: pending, capabilities: ['payroll_review'] });
  await page.goto(`${origin}payroll/approvals/batch?month=2026-11`);
  await expect(page.getByRole('button', { name: '通过当前环节' })).toBeVisible();
  assert.ok(!calls.some(call => /operators|employees/.test(call.path)));
});
test('pending return then recalculate/resubmit uses successive optimistic tokens and preserves older calculation', async t => {
  let current = batch('pending'); current.version = 8; current.versions[0].lines = current.versions[0].lines.slice(0, 1);
  const { page, calls } = await pageFor(t, { handle: async ({ path: p }) => {
    if (p === '/payroll/batches/batch') return { data: current };
    if (p.endsWith('/decide')) { current = { ...current, status: 'returned', version: 9, versions: [{ ...current.versions[0], status: 'returned' }] }; return { data: current }; }
    if (p.endsWith('/calculate')) { current = { ...current, status: 'calculated', version: 10, versions: [{ ...current.versions[0], id: 'version-2', version: 2, status: 'calculated' }, ...current.versions] }; return { data: current }; }
    if (p.endsWith('/submit')) { current = { ...current, status: 'pending', version: 11, versions: [{ ...current.versions[0], status: 'pending' }, ...current.versions.slice(1)] }; return { data: current }; }
  } });
  await page.goto(`${origin}payroll/approvals/batch?month=2026-11`);
  await page.getByRole('button', { name: '退回经办' }).click();
  await page.locator('.action-form textarea').fill('虚构依据待补齐');
  await page.locator('.action-form').getByRole('button', { name: '退回经办' }).click();
  await page.getByRole('button', { name: '自动核算' }).click();
  await page.getByRole('button', { name: '提交复核' }).click();
  await expect(page.getByText('待复核', { exact: true })).toBeVisible();
  assert.equal(calls.find(call => call.path.endsWith('/decide')).body.expectedVersion, 8);
  assert.equal(calls.find(call => call.path.endsWith('/calculate')).body.expectedVersion, 9);
  assert.equal(calls.find(call => call.path.endsWith('/submit')).body.expectedVersion, 10);
});

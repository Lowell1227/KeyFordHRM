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
  return { id: 'batch', subjectId: 'subject', month: '2026-11', payMonth: '2026-12', purpose, version: 1, status, events: [], versions: [{ id: 'version', version: 1, status, submittedById: 'fictional-hr', approvalPath: ['actor'], approvalStep: status === 'approved' ? 1 : 0, reviewerCount: 1, gross: '0.00', payDate: null, netSnapshot: null, netPayments: [], sourceHash: 'fictional-source', sources: {}, issues: [], decisions: [], exports: [], lines: [
    { id: 'line', employeeId: 'person', attributionMonth: '2026-11', itemCode: 'fixed', status: 'ready', entitlement: '0.00', paidBefore: '0', amount: '0.00', evidence: { explanation: '虚构计算依据' } },
    { id: 'na', employeeId: 'person', attributionMonth: '2026-11', itemCode: 'overtime', status: 'not_applicable', entitlement: '0.00', paidBefore: '0', amount: '0.00', evidence: { applicability: 'not_applicable' } },
    { id: 'missing', employeeId: 'person', attributionMonth: '2026-11', itemCode: 'performance', status: 'needs_configuration', entitlement: null, paidBefore: null, amount: null, evidence: {} },
  ].map(line => ({ ...line, reservation: null, settlements: [] })) }], ...more };
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
    if (p === '/payroll/performance-cycles') data = [{ id: 'cycle', name: '虚构验收周期', type: 'monthly', startDate: '2026-11-01', endDate: '2026-11-30' }];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  return { page, calls, errors };
}
const expect = require('@playwright/test').expect;
test('actual pages: attendance-only never requests wages; 1440/1024/390 layouts do not overflow', async t => {
  for (const viewport of [{ width:1440,height:900 }, { width:1024,height:768 }, { width:390,height:844 }]) {
    const { page, calls, errors } = await pageFor(t, { viewport, capabilities: ['attendance_edit'] });
    const accessReady = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/payroll/access');
    await page.goto(`${origin}payroll/attendance?month=2026-11`);
    expect((await accessReady).status()).toBe(200);
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
  const approved = batch('approved');
  approved.versions[0].lines = [{ ...approved.versions[0].lines[0], reservation: {
    subjectId: 'subject', employeeId: 'person', domain: 'validation', attributionMonth: '2026-11', itemCode: 'fixed', lineId: 'line', createdAt: '2026-12-10T00:00:00Z',
  } }];
  const { page, calls } = await pageFor(t, { batch: approved, handle: async ({ path: p, body }) => {
    if (p.endsWith('/settlements')) {
      if (first) { first = false; return { status: 503, body: JSON.stringify({ message: '虚构网络中断，请核对后重试' }) }; }
      return { data: { ...approved, version: 2, versions: [{ ...approved.versions[0], lines: [{ ...approved.versions[0].lines[0], reservation: null,
        settlements: [{ id: 'settlement', lineId: body.lineId, requestId: body.requestId, amount: body.amount, reference: body.reference, confirmedById: 'actor', createdAt: '2026-12-10T00:00:00Z' }],
      }] }] } };
    }
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
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.deepEqual(attempts[0].body, { expectedVersion: 1, lineId: 'line', amount: '0.00', reference: 'fictional-payment', requestId: attempts[0].body.requestId });
  assert.match(attempts[0].body.requestId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  assert.ok(!calls.some(call => call.path.endsWith('/net-payment')));
});
test('trial export absent; stale source blocks approval but permits assigned return', async t => {
  const trial = await pageFor(t, { batch: batch('approved', 'trial') });
  await trial.page.goto(`${origin}payroll/results/batch?month=2026-11`);
  await expect(trial.page.getByText('试算', { exact: true }).first()).toBeVisible();
  await expect(trial.page.getByRole('button', { name: '下载加密工资表' })).toHaveCount(0);
  const stale = await pageFor(t, { batch: batch('pending', 'validation', { needsUpdate: true }) });
  await stale.page.goto(`${origin}payroll/approvals/batch?month=2026-11`);
  await expect(stale.page.getByText('来源已更新，当前审批暂停。经办撤回或当前办理人退回后，重新核算并提交新版。', { exact: true })).toBeVisible();
  await expect(stale.page.getByRole('button', { name: '通过当前环节' })).toHaveCount(0);
  await expect(stale.page.getByRole('button', { name: '退回经办' })).toBeVisible();
});
test('monthly workday parameters start unconfirmed and copying a rule preserves approved automatic sources and evidence', async t => {
  const rule = { id: 'rule', subjectId: 'subject', version: 3, status: 'active', effectiveFrom: '2026-11-01', effectiveTo: null, config: {
    fixedSalaryBasis: 'monthly_workdays', workCalendars: { '2026-11': { sourceVersion: 'fictional-calendar-v1', evidenceRef: '虚构日历批准依据',
      days: Array.from({ length: 30 }, (_, index) => ({ workDate: `2026-11-${String(index + 1).padStart(2, '0')}`, units: index < 20 ? '1' : '0' })),
    } }, monthlyUnits: { '2026-11': '20' }, rounding: 'item_half_up', normalHourly: null, paidHourly: {},
    overtime: { hourlyBase: null, weekday: null, restday: null, holiday: null }, reviewers: ['actor'], approvers: ['actor'], cutoverMonth: '2026-11',
    performance: { '2026-11': { sourceKind: 'official', cycleIds: ['cycle'], coefficients: { A: '1.2' }, coefficientVersion: 'fictional-table-v1', evidenceRef: '虚构系数表批准依据' } },
  } };
  const { page, calls } = await pageFor(t, { handle: ({ path: p }) => p === '/payroll/rules' ? { data: [rule] } : undefined });
  await page.goto(`${origin}payroll/standards?month=2026-11`);
  await page.getByRole('tab', { name: '工资规则' }).click();
  await page.getByRole('button', { name: '新增规则', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '工资规则草稿', exact: true });
  const calendar = drawer.getByTestId('payroll-work-calendar');
  await expect(drawer.getByLabel('2026-11 计薪单位', { exact: true })).toHaveCount(0);
  await expect(calendar.getByLabel('日历版本', { exact: true })).toHaveValue('');
  await expect(calendar.getByLabel('日历确认依据', { exact: true })).toHaveValue('');
  await expect(calendar.getByRole('checkbox')).toHaveCount(30);
  await expect(calendar.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(drawer.getByLabel('正常计薪小时单价', { exact: true })).toHaveValue('');
  await expect(drawer.getByRole('combobox', { name: '舍入规则', exact: true })).toHaveValue('');
  await expect(drawer.getByRole('combobox', { name: '正式启用归属月切点', exact: true })).toHaveValue('');
  await drawer.getByRole('button', { name: '保存草稿' }).click(); await expect(drawer.getByText('请选择生效日期')).toBeVisible();
  await expect(calendar.getByText('请填写日历版本、确认依据并选择应出勤日期', { exact: true })).toBeVisible();
  assert.ok(!calls.some(call => call.method === 'POST'));
  assert.ok(calls.some(call => call.path.endsWith('/operators'))); assert.ok(calls.some(call => call.path.endsWith('/performance-cycles')));
  assert.ok(calls.some(call => call.path.endsWith('/employees')));
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  const discard = page.getByRole('dialog', { name: '离开编辑', exact: true });
  await expect(discard).toBeVisible();
  await expect(discard.getByText('放弃尚未保存的修改？', { exact: true })).toBeVisible();
  await discard.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(discard).toBeHidden();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: '复制草稿', exact: true }).first().click();
  await expect(calendar.getByLabel('日历版本', { exact: true })).toHaveValue('fictional-calendar-v1');
  await expect(calendar.getByLabel('日历确认依据', { exact: true })).toHaveValue('虚构日历批准依据');
  await expect(calendar.getByRole('checkbox', { checked: true })).toHaveCount(20);
  await expect(drawer.getByLabel('统一系数表版本', { exact: true })).toHaveValue('fictional-table-v1');
  await expect(drawer.getByLabel('系数确认依据', { exact: true })).toHaveValue('虚构系数表批准依据');
  await expect(drawer.getByLabel('A 等系数', { exact: true })).toHaveValue('1.2');
  await expect(drawer.locator('.el-form-item').filter({ has: page.getByText('绩效周期', { exact: true }) })).toContainText('虚构验收周期');
  await expect(drawer.getByTestId('payroll-manual-performance')).toHaveCount(0);
});
test('actual results distinguish not applicable, ready zero and missing; screenshots at desktop/mobile', async t => {
  for (const viewport of [{ width:1440,height:900 }, { width:1024,height:768 }, { width:390,height:844 }]) {
    const { page, errors } = await pageFor(t, { viewport, batch: batch('approved') });
    await page.goto(`${origin}payroll/results/batch?month=2026-11`);
    const cases = [
      { item: '固定工资', status: '已核算', entitlement: '0.00', paid: '0', amount: '0.00' },
      { item: '加班工资', status: '不适用', entitlement: '0.00', paid: '0', amount: '不适用' },
      { item: '个人绩效', status: '待配置', entitlement: '待配置', paid: '待确认', amount: '待核对 / 待配置' },
    ];
    if (viewport.width <= 768) {
      const rows = page.locator('.payroll-lines-mobile .mobile-line');
      await expect(rows).toHaveCount(3);
      for (const value of cases) {
        const row = rows.filter({ has: page.getByText(`2026-11 · ${value.item}`, { exact: true }) });
        await expect(row.getByText(`${value.status} · 本批待结余额 ${value.amount}`, { exact: true })).toBeVisible();
        await expect(row.getByText(`全额应发 ${value.entitlement} · 历史已入薪 ${value.paid}`, { exact: true })).toBeVisible();
      }
    } else {
      const rows = page.locator('.payroll-lines-desktop .el-table__body-wrapper .el-table__row');
      await expect(rows).toHaveCount(3);
      for (const value of cases) {
        const cells = rows.filter({ has: page.getByText(value.item, { exact: true }) }).locator('td .cell');
        await expect(cells.nth(4)).toHaveText(value.status);
        await expect(cells.nth(5)).toHaveText(value.entitlement);
        await expect(cells.nth(6)).toHaveText(value.paid);
        await expect(cells.nth(7)).toHaveText(value.amount);
      }
    }
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

test('submit conflict offers the protected original batch without resubmitting or overwriting it', async t => {
  const ready = batch(); ready.versions[0].lines = ready.versions[0].lines.slice(0, 1);
  const originalId = '11111111-1111-4111-8111-111111111111';
  const { page, calls } = await pageFor(t, { batch: ready, handle: async ({ path: p }) => {
    if (p.endsWith('/submit')) return { status: 409, body: JSON.stringify({ code: 4090, message: '原批次已占用，请核对', data: { batchId: originalId } }) };
    if (p === `/payroll/batches/${originalId}`) return { data: batch('pending', 'validation', { id: originalId }) };
  } });
  await page.goto(`${origin}payroll/batches/batch?month=2026-11`);
  await page.getByRole('button', { name: '提交复核', exact: true }).click();
  await expect(page.getByTestId('payroll-action-error')).toContainText('原批次已占用');
  await page.getByRole('button', { name: '查看冲突批次', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/payroll/batches/${originalId}`));
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 1);
  assert.ok(calls.some(call => call.method === 'GET' && call.path === `/payroll/batches/${originalId}`));
});

test('an approved cross-month hold explains the financial pause without requesting an impossible withdrawal', async t => {
  const { page } = await pageFor(t, { batch: batch('approved', 'validation', { needsUpdate: true }) });
  await page.goto(`${origin}payroll/results/batch?month=2026-11`);
  await expect(page.getByText('核算来源已变化或存在归属冲突，下载和新增入薪已暂停。请核对原月及已入薪差异，原批准记录保留。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载加密工资表', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认入薪', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '撤回重算', exact: true })).toHaveCount(0);
});

test('the held partial-payment page can cancel the remainder without changing the original amount or paid history', async t => {
  const held = batch('approved', 'validation', { needsUpdate: true });
  held.versions[0].lines = [{ ...held.versions[0].lines[0], amount: '200.00', reservation: { lineId: 'line' },
    settlements: [{ id: 'paid', amount: '150.00', reference: 'fictional-original-payment' }] }];
  const { page, calls } = await pageFor(t, { batch: held, handle: async ({ path: p }) => p.endsWith('/cancel-remainder')
    ? { data: { ...held, versions: [{ ...held.versions[0], lines: [{ ...held.versions[0].lines[0], reservation: null }] }] } } : undefined });
  await page.goto(`${origin}payroll/results/batch?month=2026-11`);
  await page.getByRole('button', { name: '取消剩余支付安排', exact: true }).click();
  const form = page.locator('.action-form');
  await form.locator('.el-select').click(); await page.getByRole('option').filter({ hasText: '固定工资' }).click();
  await form.getByRole('textbox').fill('fictional-stop-remainder');
  await form.getByRole('button', { name: '取消剩余支付安排', exact: true }).click();
  await page.getByRole('dialog', { name: '取消剩余安排', exact: true }).getByRole('button', { name: '取消剩余安排', exact: true }).click();
  await expect(page.getByText('取消剩余支付安排已完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认入薪', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下载加密工资表', exact: true })).toHaveCount(0);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(held.versions[0].lines[0].amount, '200.00');
  assert.equal(held.versions[0].lines[0].settlements[0].amount, '150.00');
});

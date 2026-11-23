// Substituted HTTP is interaction evidence only; real backend acceptance belongs to integration.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const web = path.resolve(__dirname, '..');
let server, browser, origin;

function batch(more = {}) {
  return { id: 'batch', subjectId: 'subject', month: '2035-11', payMonth: '2035-12', purpose: 'validation', version: 7, status: 'calculated', events: [], versions: [{
    id: 'calculation', version: 2, status: 'calculated', submittedById: 'fictional-hr', sourceHash: 'fictional-source', sources: {}, issues: [], approvalPath: ['actor'], approvalStep: 0, reviewerCount: 1, gross: '18000.00', payDate: null, netSnapshot: null, netPayments: [], decisions: [], exports: [],
    lines: [{ id: 'line', employeeId: 'person', itemCode: 'fixed', attributionMonth: '2035-11', status: 'ready', amount: '10000.00', entitlement: '10000.00', paidBefore: '0.00', evidence: {} }],
  }], ...more };
}
function response(body, more = {}) {
  return { batchId: 'batch', batchVersion: 7, calculationVersion: 2, calculationVersionId: 'calculation', subjectId: 'subject', sourceHash: 'fictional-source', payMonth: '2035-12', ...body,
    basis: 'fictional', approvalStatus: 'not_submitted', rows: [{ employeeId: 'person', employeeName: '虚构员工甲（长姓名与缺项检查）', status: 'ready', issues: [], gross: '10000.00', socialInsurance: '800.00', housingFund: '500.00', incomeTax: '60.00', net: '8640.00', evidence: { sourceHash: 'fictional-evidence', input: { socialInsurance: { ruleVersion: 'fictional-v1', evidenceRef: 'fictional-only' } } } }],
    totals: { gross: '18000.00', socialInsurance: '1440.00', housingFund: '900.00', incomeTax: '180.00', net: '15480.00' }, ...more };
}

before(async () => {
  const { createServer } = await import('vite'), vue = await import('@vitejs/plugin-vue');
  server = await createServer({ configFile: false, root: web, plugins: [vue.default(), { name: 'deductions-test-harness', configureServer(vite) {
    vite.middlewares.use('/__deductions-harness', async (req, res, next) => {
      if (req.url.includes('html-proxy')) { next(); return; }
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml('/__deductions-harness', `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module">
        import {createApp, ref, h} from 'vue';
        import ElementPlus from 'element-plus';
        import '/node_modules/element-plus/dist/index.css';
        import Preview from '/src/views/compensation/payroll/PayrollDeductionsPreview.vue';
        const batch = ref(${JSON.stringify(batch())}), disabled = ref(false), mounted = ref(true), events = [];
        window.fixture = {batch, disabled, mounted, events};
        createApp({setup:()=>()=>mounted.value ? h(Preview, {batch:batch.value, disabled:disabled.value, onBusy:value=>events.push(value)}) : null}).use(ElementPlus).mount('#app');
      </script></body></html>`));
    });
  } }], resolve: { alias: { '@': path.join(web, 'src') } }, define: { 'import.meta.env.VITE_PREVIEW_MODE': JSON.stringify('true') }, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function pageFor(t, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), calls = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('token', 'fictional-test'); localStorage.setItem('expiresAt', String(Date.now() + 3600000)); });
  const access = { enabled: true, subjects: [{ id: 'subject', name: '虚构主体', capabilities: options.caps ?? ['payroll_edit', 'payroll_view'] }] };
  await page.route('**/api/v1/**', async route => {
    const p = new URL(route.request().url()).pathname.replace('/api/v1', ''), body = route.request().postDataJSON();
    calls.push({ path: p, method: route.request().method(), body });
    if (p.endsWith('/deductions-preview')) {
      const value = await options.preview?.(body, calls);
      await route.fulfill({ status: value?.status ?? 200, contentType: 'application/json', body: JSON.stringify(value?.error ? { message: value.error } : { code: 0, data: response(body, value?.data) }) });
      return;
    }
    let data = [];
    if (p === '/auth/me') data = { id: 'actor', name: '虚构经办', sysRole: 'employee', payrollAccess: access };
    if (p === '/payroll/access') data = access;
    if (p === '/payroll/batches') data = [options.batch ?? batch()];
    if (p === '/payroll/batches/batch') data = options.batch ?? batch();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  await page.goto(`${origin}${options.harness ? '__deductions-harness' : 'payroll/batches/batch?month=2035-11'}`);
  if (options.harness) await page.waitForFunction(() => window.fixture, { timeout: 5000 }).catch(cause => { throw new Error(`${cause.message}; browser errors: ${errors.join('; ')}`); });
  return { page, calls, errors, region: page.getByTestId('payroll-deductions-preview') };
}
const attempts = calls => calls.filter(call => call.path.endsWith('/deductions-preview'));
async function calculate(region) {
  await region.getByLabel('试算发薪日', { exact: true }).fill('2035-12-15');
  await region.getByRole('button', { name: '试算', exact: true }).click();
}

function assertServerMoneyBoundary(file, source) {
  assert.equal(/parseFloat|toFixed\s*\(|localStorage|sessionStorage/.test(source), false, `${file}: client money conversion or browser persistence is forbidden`);
  const descriptor = file.endsWith('.vue') ? parse(source).descriptor : undefined;
  const script = descriptor ? [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n') : source;
  const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const mathRound = (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Math' && callee.name.text === 'round')
        || (ts.isElementAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Math' && ts.isStringLiteral(callee.argumentExpression) && callee.argumentExpression.text === 'round');
      if (mathRound) {
        const input = node.arguments[0];
        const conversion = input && ts.isBinaryExpression(input) ? input.left : undefined;
        const units = conversion && ts.isCallExpression(conversion) ? conversion.arguments[0] : undefined;
        // Only the existing calendar-day unit sum may round; currency paths get no exemption.
        assert.ok(['PayrollWorkCalendarEditor.vue', 'PayrollStandardsView.vue', 'PayrollParameterReviewsView.vue'].includes(file)
          && node.arguments.length === 1 && ts.isBinaryExpression(input) && input.operatorToken.kind === ts.SyntaxKind.AsteriskToken
          && ts.isNumericLiteral(input.right) && input.right.text === '10000'
          && ts.isCallExpression(conversion) && ts.isIdentifier(conversion.expression) && conversion.expression.text === 'Number' && conversion.arguments.length === 1
          && ts.isPropertyAccessExpression(units) && ts.isIdentifier(units.expression) && units.expression.text === 'day' && units.name.text === 'units',
        `${file}: rounding is permitted only for calendar day.units`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

test('client money guard permits calendar-unit sums only, rejects monetary rounding, conversion and browser persistence', () => {
  const source = script => `<script setup lang="ts">${script}</script>`;
  assertServerMoneyBoundary('PayrollWorkCalendarEditor.vue', source('Math.round(Number(day.units) * 10000)'));
  for (const [file, script] of [
    ['PayrollDeductionsPreview.vue', 'Math.round(Number(day.units) * 10000)'],
    ['PayrollStandardsView.vue', 'Math.round(Number(day.amount) * 10000)'],
    ['PayrollWorkCalendarEditor.vue', 'Math["round"](Number(row.net) * 100)'],
    ['PayrollDeductionsPreview.vue', 'parseFloat(row.net)'],
    ['PayrollDeductionsPreview.vue', 'Number(row.net).toFixed(2)'],
    ['PayrollDeductionsPreview.vue', 'localStorage.setItem("net", row.net)'],
    ['PayrollDeductionsPreview.vue', 'sessionStorage.setItem("net", row.net)'],
  ]) assert.throws(() => assertServerMoneyBoundary(file, source(script)), assert.AssertionError, script);
});

test('deductions API carries only the optimistic token, explicit date and mode', async () => {
  const filename = path.join(web, 'src/api/payroll.api.ts'), calls = [], m = new Module(filename, module);
  m.require = id => id === './http' ? { default: { post: (...args) => { calls.push(args); return Promise.resolve({}); } } } : require(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  assert.equal(typeof m.exports.payrollApi.deductionsPreview, 'function');
  await m.exports.payrollApi.deductionsPreview('batch/a', { expectedVersion: 7, payDate: '2035-12-15', mode: 'missing' });
  assert.deepEqual(calls, [['/payroll/batches/batch%2Fa/deductions-preview', { expectedVersion: 7, payDate: '2035-12-15', mode: 'missing' }, { skipErrorMessage: true }]]);
});

test('manual preview validates empty/invalid/out-of-month dates and never calculates money locally', async t => {
  // Intentionally independent server totals catch any attempt to sum rows or recompute net in the browser.
  const savedTotals = { gross: '18000.00', socialInsurance: '111.11', housingFund: '222.22', incomeTax: '333.33', net: '7777.77' };
  const { page, region, calls, errors } = await pageFor(t, { preview: body => body.mode === 'saved' ? { data: { totals: savedTotals } } : undefined });
  await expect(region).toBeVisible();
  await expect(region.getByText('虚构试算 · 实发未审批', { exact: true })).toBeVisible();
  const date = region.getByLabel('试算发薪日', { exact: true });
  await expect(date).toHaveValue('');
  assert.equal(attempts(calls).length, 0);
  for (const [value, message] of [['', '请选择试算发薪日'], ['2035-12-32', '请输入有效的日历日期'], ['2035-11-30', '试算发薪日须在本批发放月 2035-12 内']]) {
    await date.fill(value); await region.getByRole('button', { name: '试算', exact: true }).click();
    await expect(region.getByText(message, { exact: true })).toBeVisible();
  }
  assert.equal(attempts(calls).length, 0);
  await calculate(region);
  await expect(region.getByTestId('payroll-deductions-preview-totals')).toContainText('15480.00');
  for (const [key, value] of Object.entries({ gross: '18000.00', socialInsurance: '1440.00', housingFund: '900.00', incomeTax: '180.00', net: '15480.00' })) {
    await expect(region.getByTestId(`payroll-deductions-preview-total-${key}`)).toHaveText(value);
  }
  assert.deepEqual(attempts(calls)[0].body, { expectedVersion: 7, payDate: '2035-12-15', mode: 'complete' });
  await region.getByText('已审核资料', { exact: true }).click();
  await expect(region.getByTestId('payroll-deductions-preview-totals')).toHaveCount(0);
  await calculate(region);
  for (const [key, value] of Object.entries(savedTotals)) await expect(region.getByTestId(`payroll-deductions-preview-total-${key}`)).toHaveText(value);
  assert.deepEqual(attempts(calls).map(call => call.body), [
    { expectedVersion: 7, payDate: '2035-12-15', mode: 'complete' },
    { expectedVersion: 7, payDate: '2035-12-15', mode: 'saved' },
  ]);
  assert.deepEqual(errors, []);
  const directory = path.join(web, 'src/views/compensation/payroll');
  for (const file of fs.readdirSync(directory)) assertServerMoneyBoundary(file, fs.readFileSync(path.join(directory, file), 'utf8'));
});

test('only an editable current nonformal calculated/pending/approved batch shows preview', async t => {
  for (const options of [{ caps: ['payroll_view'] }, { batch: batch({ purpose: 'formal' }) }, { batch: batch({ status: 'draft' }) }, { batch: batch({ needsUpdate: true }) }, { batch: batch({ status: 'returned' }) }]) {
    const { page, region, calls } = await pageFor(t, options);
    await expect(page.getByRole('combobox', { name: '计算版本', exact: true })).toBeVisible();
    await expect(region).toHaveCount(0); assert.equal(attempts(calls).length, 0);
  }
  const current = batch(); current.versions.push({ ...current.versions[0], id: 'old', version: 1 });
  const { page, region } = await pageFor(t, { batch: current });
  await calculate(region); await expect(region.getByTestId('payroll-deductions-preview-totals')).toBeVisible();
  await page.locator('.detail-toolbar .el-select').click();
  await page.getByRole('option').filter({ hasText: '第 1 版' }).click();
  await expect(region).toHaveCount(0);
  await page.locator('.detail-toolbar .el-select').click();
  await page.getByRole('option').filter({ hasText: '第 2 版' }).click();
  await expect(region).toBeVisible(); await expect(region.getByTestId('payroll-deductions-preview-totals')).toHaveCount(0);
});

test('missing configuration never becomes zero or a complete total; evidence starts folded', async t => {
  const { region } = await pageFor(t, { preview: () => ({ data: { rows: [{ employeeId: 'person', employeeName: '虚构缺项员工', status: 'needs_configuration', issues: ['缺少虚构税务参数'], gross: null, socialInsurance: null, housingFund: null, incomeTax: null, net: null, evidence: { input: null, sourceHash: null } }], totals: null } }) });
  await region.getByText('缺项检查', { exact: true }).click(); await calculate(region);
  const rows = region.getByTestId('payroll-deductions-preview-rows');
  await expect(rows).toContainText('待配置'); await expect(rows).not.toContainText('0.00');
  await expect(region.getByTestId('payroll-deductions-preview-totals')).toHaveCount(0);
  await expect(region.getByText('部分人员待配置或待核对，暂无完整汇总', { exact: true })).toBeVisible();
  await expect(region.locator('details[open]')).toHaveCount(0);
});

test('busy prevents duplicate actions/route leaving and errors retain input for retry', async t => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const { page, region, calls } = await pageFor(t, { preview: async () => {
    if (attempts(calls).length === 1) { started(); await new Promise(resolve => { release = resolve; }); return { status: 503, error: '虚构网络中断，请重试' }; }
  } });
  await calculate(region); await waiting;
  await expect(region.getByRole('button', { name: '试算', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '刷新批次', exact: true })).toBeDisabled();
  await page.evaluate(async () => { const { default: router } = await import('/src/router/index.ts'); await router.push('/payroll/batches'); });
  await expect(page).toHaveURL(/\/payroll\/batches\/batch/);
  release();
  await expect(region.getByText('虚构网络中断，请重试', { exact: true })).toBeVisible();
  await expect(region.getByLabel('试算发薪日', { exact: true })).toHaveValue('2035-12-15');
  await region.getByRole('button', { name: '试算', exact: true }).click();
  await expect(region.getByTestId('payroll-deductions-preview-totals')).toBeVisible();
  assert.equal(attempts(calls).length, 2);
});

test('changing date/mode/batch/version/subject or unmounting discards a late response and releases busy', async t => {
  for (const change of ['date', 'mode', 'id', 'version', 'subjectId', 'calculation', 'unmount']) {
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    const { page, region } = await pageFor(t, { harness: true, preview: async () => { started(); await new Promise(resolve => { release = resolve; }); } });
    await expect(region).toBeVisible(); await calculate(region); await waiting;
    if (change === 'date') await region.getByLabel('试算发薪日', { exact: true }).fill('2035-12-16');
    else if (change === 'mode') await region.getByText('缺项检查', { exact: true }).click();
    else await page.evaluate(key => {
      const f = window.fixture;
      if (key === 'unmount') f.mounted.value = false;
      else if (key === 'calculation') f.batch.value.versions[0].id = 'new-calculation';
      else f.batch.value[key] = key === 'version' ? 8 : `other-${key}`;
    }, change);
    release();
    await expect.poll(() => page.evaluate(() => window.fixture.events.at(-1))).toBe(false);
    await expect(region.getByTestId('payroll-deductions-preview-totals')).toHaveCount(0);
  }
});

test('changing inputs clears an existing result; disabled prevents calls; calendar validation rejects rolled dates', async t => {
  const { page, region, calls } = await pageFor(t, { harness: true });
  await calculate(region); await expect(region.getByTestId('payroll-deductions-preview-totals')).toBeVisible();
  await region.getByText('缺项检查', { exact: true }).click();
  await expect(region.getByTestId('payroll-deductions-preview-totals')).toHaveCount(0);
  await page.evaluate(() => { window.fixture.disabled.value = true; });
  await expect(region.getByRole('button', { name: '试算', exact: true })).toBeDisabled(); assert.equal(attempts(calls).length, 1);
  await page.evaluate(() => { window.fixture.disabled.value = false; window.fixture.batch.value.payMonth = '2035-02'; });
  await region.getByLabel('试算发薪日', { exact: true }).fill('2035-02-29');
  await region.getByRole('button', { name: '试算', exact: true }).click();
  await expect(region.getByText('请输入有效的日历日期', { exact: true })).toBeVisible(); assert.equal(attempts(calls).length, 1);
});

test('PC/tablet table and mobile cards fit long names and expose server totals without page overflow', async t => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    const { page, region, errors } = await pageFor(t, { viewport }); await calculate(region);
    await expect(region.getByTestId('payroll-deductions-preview-totals')).toBeVisible();
    await expect(region.locator(viewport.width <= 768 ? '.mobile-result-card' : '.el-table').first()).toBeVisible();
    await expect(region.getByTestId('payroll-deductions-preview-rows')).toContainText('8640.00');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await region.screenshot({ path: path.join(os.tmpdir(), `payroll-deductions-preview-${viewport.width}.png`) });
    assert.deepEqual(errors, []);
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src/views/compensation/payroll');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const RA = '33333333-3333-4333-8333-333333333333', RB = '44444444-4444-4444-8444-444444444444';
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function batch(subjectId = A) {
  const result = { status: 'ready', issues: [], gross: '100.00', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '0.00', net: '100.00', evidence: {} };
  return { id: 'batch', subjectId, month: '2037-01', payMonth: '2037-02', purpose: 'reconciliation', status: 'calculated', version: 5,
    versions: [{ id: 'version', version: 1, issues: [], gross: '100.00', payDate: '2037-02-10', netPayments: [], lines: [],
      netSnapshot: { schema: 1, payDate: '2037-02-10', sourceHash: 'fictional', totals: { gross: '100.00', socialInsurance: '0.00', housingFund: '0.00', incomeTax: '0.00', net: '100.00' },
        rows: [{ employeeId: 'fictional', employeeName: 'Fictional person', employeeNo: 'F001', result }] } }] };
}
function receipt(id = RA) {
  const source = batch(id === RA ? A : B);
  return { request: { id, subjectId: source.subjectId, batchId: source.id, versionId: 'version', calculationVersion: 1, version: 1,
    month: '2037-01', firstMonth: '2037-02', sourceHash: 'fictional', netHash: 'fictional', reference: 'Fictional reconciliation', status: 'pending',
    approvalStep: 0, approvalPath: ['reviewer', 'approver'], reviewerCount: 1, submittedById: 'hr', submittedAt: '2037-02-01T00:00:00Z',
    approvedAt: null, closedAt: null, closedById: null, closeNote: null, decisions: [] }, netSnapshot: source.versions[0].netSnapshot,
    lines: [], actors: [{ id: 'reviewer', name: 'Fictional reviewer' }], canDecide: true, canWithdraw: false, canRevoke: false };
}
function loadTs(file, dependencies = {}) {
  const m = new Module(file, module); m.paths = Module._nodeModulePaths(path.dirname(file));
  const original = m.require.bind(m);
  m.require = name => Object.hasOwn(dependencies, name) ? dependencies[name]
    : name.startsWith('./') ? loadTs(path.resolve(path.dirname(file), `${name}.ts`), dependencies) : original(name);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, file);
  return m.exports;
}
function fixture(t, integrated = false) {
  const updates = [], leaves = [], calls = [], confirmations = [], emitted = [];
  const discardPrompts = [], discardResponses = [];
  const route = vue.reactive({ path: integrated === 'standards' ? '/payroll/standards' : '/payroll/batches', params: {}, query: { subjectId: A, month: '2037-01', readiness: RA } });
  const auth = vue.reactive({ token: 'fictional', user: { id: 'reviewer' }, refreshPayrollAccess: async () => ({ enabled: true,
    subjects: [A, B].map(id => ({ id, name: 'Fictional payer', capabilities: ['payroll_edit', 'payroll_view', 'payroll_review'] })) }) });
  const api = {
    readinessRequest: async id => receipt(id), readinessRequests: async () => [], batches: async id => [batch(id)],
    readiness: async () => ({ ready: false }), employees: async () => [],
    standards: async () => [], rules: async () => [], operators: async () => [], cycles: async () => [],
    createRule: async body => { calls.push({ method: 'createRule', body: structuredClone(body) }); return {}; },
    decideReadiness: async (...args) => { calls.push({ method: 'decide', args }); return receipt(args[0]); },
    revokeReadiness: async (...args) => { calls.push({ method: 'revoke', args }); return receipt(args[0]); },
    withdrawReadiness: async (...args) => { calls.push({ method: 'withdraw', args }); return receipt(args[0]); },
    submitReadiness: async body => { calls.push({ method: 'submit', body: structuredClone(body) }); throw new Error('Fictional network failure'); },
  };
  const router = { push: async target => { route.path = target.path; route.query = target.query; }, replace: async target => { route.path = target.path; route.query = target.query; }, back() {} };
  const dependencies = {
    'vue-router': { useRoute: () => route, useRouter: () => router, onBeforeRouteUpdate: guard => updates.push(guard), onBeforeRouteLeave: guard => leaves.push(guard) },
    'element-plus': { ElMessageBox: { confirm: (_message, title) => {
      if (title === '离开编辑') {
        discardPrompts.push(_message);
        return discardResponses.shift() === true ? Promise.resolve() : Promise.reject(new Error('Keep unsaved content'));
      }
      const pending = deferred(); confirmations.push(pending); return pending.promise;
    } } },
    '@element-plus/icons-vue': {}, '@/api/payroll.api': { payrollApi: api, payrollError: async error => error.message },
    '@/stores/auth.store': { useAuthStore: () => auth },
    '@/utils/preview-mode': { isLocalPreview: true },
  };
  function component(name) {
    const file = path.join(root, name), m = new Module(file, module); m.paths = module.paths;
    const original = m.require.bind(m);
    m.require = dependency => Object.hasOwn(dependencies, dependency) ? dependencies[dependency]
      : dependency.endsWith('.vue') ? {} : dependency.startsWith('./') ? loadTs(path.resolve(root, `${dependency}.ts`), dependencies) : original(dependency);
    const script = compileScript(parse(fs.readFileSync(file, 'utf8')).descriptor, { id: file }).content.replace(/import\.meta\.env\.VITE_PREVIEW_MODE/g, "'false'");
    m._compile(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, file);
    return m.exports.default;
  }
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  const props = vue.reactive({ modelValue: true, subjectId: A, batches: [batch()], canSubmit: true, requestId: RA });
  const panel = component('PayrollReadinessPanel.vue'), setup = panel.setup;
  let state, parent, mounted = true;
  panel.setup = (values, context) => { state = setup(values, context); return state; };
  panel.render = () => null;
  let app;
  if (integrated) {
    const parentComponent = component(integrated === 'standards' ? 'PayrollStandardsView.vue' : 'PayrollBatchesView.vue'), parentSetup = parentComponent.setup;
    parentComponent.setup = (values, context) => { parent = parentSetup(values, context); return parent; };
    parentComponent.render = integrated === 'standards' ? () => null : () => vue.h(panel, { modelValue: parent.readinessOpen.value, subjectId: parent.subjectId.value,
      batches: parent.batches.value, canSubmit: parent.has('payroll_edit'), requestId: parent.readinessId.value,
      'onUpdate:modelValue': parent.closeReadiness, onSelect: parent.selectReadiness, onChanged: parent.load });
    app = renderer.createApp(parentComponent, { mode: 'batches' });
  } else app = renderer.createApp({ setup() { state = setup(props, { expose() {}, emit: (...event) => emitted.push(event) }); return () => null; } });
  app.mount({});
  const unmount = () => { if (mounted) { mounted = false; app.unmount(); } }; t.after(unmount);
  async function navigate(query) {
    const to = { path: route.path, query }, from = { path: route.path, query: { ...route.query } };
    for (const guard of updates) if (await guard(to, from) === false) return false;
    route.query = query; await flush(); return true;
  }
  return { props, api, calls, confirmations, discardPrompts, discardResponses, emitted, unmount, navigate, route, get state() { return state; }, get parent() { return parent; } };
}

test('late detail success cannot replace the newly selected signoff', async t => {
  const f = fixture(t), old = deferred();
  await flush(); f.api.readinessRequest = id => id === RA ? old.promise : Promise.resolve(receipt(id));
  const first = f.state.load(); f.props.requestId = RB; f.props.subjectId = B; await flush();
  old.resolve(receipt(RA)); await first;
  assert.equal(f.state.detail.value.request.id, RB);
});

test('failed submission preserves evidence, selected period and idempotency key for an unchanged retry', async t => {
  const f = fixture(t); await flush(); f.state.create();
  Object.assign(f.state.draft, { batchId: 'batch', firstMonth: '2037-02', reference: 'Fictional checked evidence' });
  const before = JSON.stringify(f.state.draft);
  await f.state.submit(); assert.equal(JSON.stringify(f.state.draft), before); assert.equal(f.state.creating.value, true);
  assert.match(f.state.error.value, /network failure/);
  await f.state.submit(); assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[0].body, f.calls[1].body);
});

test('confirmation must not submit a signoff after its owning component was unmounted', async t => {
  const f = fixture(t); await flush(); const action = f.state.act('approve');
  assert.equal(f.confirmations.length, 1); f.unmount(); f.confirmations[0].resolve(); await action;
  assert.equal(f.calls.filter(call => call.method === 'decide').length, 0, 'leaving the screen must invalidate its pending confirmation');
});

test('leaving and reopening the same id/version must not reuse an earlier confirmation', async t => {
  const f = fixture(t); await flush(); const action = f.state.act('approve');
  f.props.modelValue = false; await flush(); f.props.modelValue = true; await flush();
  assert.equal(f.state.detail.value.request.id, RA);
  f.confirmations[0].resolve(); await action;
  assert.equal(f.calls.filter(call => call.method === 'decide').length, 0, 'record identity alone does not identify the confirmation context');
});

test('query navigation must honor refused discard of an unsaved signoff opinion', async t => {
  const f = fixture(t, true); await flush(); f.state.note.value = 'Unsaved fictional return evidence';
  const allowed = await f.navigate({ subjectId: A, month: '2037-01' });
  assert.equal(allowed, false, 'browser back/query changes must run the same discard protection as the Close button');
  assert.equal(f.state.note.value, 'Unsaved fictional return evidence');
});

test('Batches explicitly opts into query sync so cross-payer signoff links select the authorized scope', async t => {
  const f = fixture(t, true); await flush();
  await f.navigate({ subjectId: B, month: '2037-02', readiness: RB });
  assert.equal(f.parent.subjectId.value, B);
  assert.equal(f.parent.month.value, '2037-02');
  assert.equal(f.state.detail.value.request.id, RB); assert.equal(f.state.error.value, '');
});

test('default scope does not follow query changes or move an open maintenance draft to another payer', async t => {
  const f = fixture(t, 'standards'); await flush();
  f.parent.edit('rule'); f.parent.rule.value.effectiveFrom = '2037-01-01';
  f.parent.rule.value.config.fixedSalaryBasis = null;
  const before = JSON.stringify(f.parent.rule.value);
  assert.equal(f.parent.subjects.value.some(subject => subject.id === B), true, 'both payers are authorized; this is draft isolation, not a permission rejection');
  assert.equal(await f.navigate({ subjectId: B, month: '2037-02' }), true);
  assert.equal(f.parent.subjectId.value, A, 'a query-only update must not replace the subject of an open maintenance form');
  assert.equal(f.parent.month.value, '2037-01');
  assert.equal(f.parent.open.value, true);
  assert.equal(JSON.stringify(f.parent.rule.value), before);
  await f.parent.save();
  const writes = f.calls.filter(call => call.method === 'createRule');
  assert.equal(writes.length, 1, JSON.stringify(f.parent.fields));
  assert.equal(writes[0].body.subjectId, A, 'saving must use the original payer, not the new route query');
  assert.equal(writes[0].body.effectiveFrom, '2037-01-01');
});

test('reopening a signoff starts a new discard confirmation even when the opinion text is identical', async t => {
  const f = fixture(t, true); await flush();
  const opinion = 'Repeated fictional return evidence';
  f.state.note.value = opinion; f.discardResponses.push(true);
  assert.equal(await f.navigate({ subjectId: A, month: '2037-01' }), true);
  assert.equal(f.discardPrompts.length, 1);
  assert.equal(f.state.note.value, '');
  assert.equal(await f.navigate({ subjectId: A, month: '2037-01', readiness: RA }), true);
  f.state.note.value = opinion; f.discardResponses.push(false);
  assert.equal(await f.navigate({ subjectId: A, month: '2037-01' }), false, 'a previous discard belongs only to its old editing session');
  assert.equal(f.discardPrompts.length, 2);
  assert.equal(f.state.note.value, opinion, 'refusing the new discard keeps the new opinion');
  assert.equal(f.route.query.readiness, RA);
});

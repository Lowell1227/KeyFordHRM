// Component-state and presentation regressions; no HTTP, database or dev server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src/views/compensation/payroll');
const flush = () => new Promise(resolve => setImmediate(resolve));

function load(file, overrides = {}, render = false) {
  const filename = path.join(root, file);
  assert.ok(fs.existsSync(filename), `Missing payroll presentation: ${file}`);
  let source = fs.readFileSync(filename, 'utf8');
  if (file.endsWith('.vue')) {
    const { descriptor } = parse(source), script = compileScript(descriptor, { id: file, ...(render ? { genDefaultAs: 'View' } : {}) });
    source = script.content;
    if (render) {
      const template = compileTemplate({ source: descriptor.template.content, filename, id: file, compilerOptions: { bindingMetadata: script.bindings } });
      assert.deepEqual(template.errors, []);
      source += `\n${template.code}\nView.render = render;\nexport default View;`;
    }
  }
  source = source.replace(/import\.meta\.env\.VITE_PREVIEW_MODE/g, "'false'");
  const m = new Module(filename, module); m.paths = module.paths;
  m.require = id => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id.endsWith('.vue')) return {};
    if (id.startsWith('./')) return load(`${id.slice(2)}.ts`, overrides);
    return require(id);
  };
  m._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return m.exports;
}

function rendered(t, file, props) {
  const node = (type, text = '') => ({ type, text, children: [], parent: null });
  const renderer = vue.createRenderer({
    createElement: type => node(type), createText: text => node('#text', text), createComment: () => node('#comment'),
    insert(child, parent, anchor) { const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, child); child.parent = parent; },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1); },
    setText(child, text) { child.text = text; }, setElementText(child, text) { child.text = text; child.children = []; },
    patchProp() {}, parentNode: child => child.parent, nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  });
  const app = renderer.createApp(load(file, {}, true).default, props);
  const pass = { setup: (_, { slots }) => () => vue.h('div', slots.default?.()) };
  app.component('el-timeline', pass);
  app.component('el-timeline-item', { props: ['timestamp'], setup: (props, { slots }) => () => vue.h('div', [props.timestamp, slots.default?.()]) });
  const root = node('root'); app.mount(root); t.after(() => app.unmount());
  // A hidden technical trace cannot satisfy a business summary assertion.
  const visibleText = item => item.type === 'details' ? '' : item.text + item.children.map(visibleText).join('');
  return visibleText(root);
}

async function standards(t, options = {}) {
  const writes = [], navigations = [];
  const people = [{ id: 'a', name: 'Fictional A', employeeNo: 'F001' }, { id: 'b', name: 'Fictional B', employeeNo: 'F002' }, { id: 'conflict', name: 'Fictional conflict', employeeNo: 'F003', unavailableReason: '任职重叠待核' }];
  const scope = { subjects: vue.ref([]), subjectId: vue.ref('subject'), month: vue.ref('2037-01'), has: () => true, loading: vue.ref(false), error: vue.ref(''), refreshAccess: async () => {} };
  const component = load('PayrollStandardsView.vue', {
    vue: { ...vue, onMounted() {}, onScopeDispose() {} },
    'vue-router': { useRoute: () => ({ query: { subjectId: 'subject', month: '2037-01' } }), useRouter: () => ({ push: async value => navigations.push(value) }), onBeforeRouteLeave() {} },
    'element-plus': { ElMessageBox: {} }, '@element-plus/icons-vue': {},
    '@/utils/preview-mode': { isLocalPreview: false }, './usePayrollScope': { usePayrollScope: () => scope },
    '@/api/payroll.api': { payrollApi: {
      standards: async () => [], rules: async () => [], employees: async (_, month) => options.employees?.(month) ?? [],
      operators: async () => [], cycles: async () => [], employeeScopeCandidates: async () => people,
      createRule: async value => { writes.push(JSON.parse(JSON.stringify(value))); return { id: 'draft', version: 1, ...value }; },
    }, payrollError: async error => error.message },
  }).default;
  const effect = vue.effectScope(); t.after(() => effect.stop());
  const vm = effect.run(() => component.setup({}, { expose() {} }));
  vm.edit('rule'); vm.rule.value.effectiveFrom = '2037-01-01'; await flush();
  vm.rule.value.config.employeeScope = { employeeIds: ['a'], evidenceRef: 'Fictional approved payer scope' };
  vm.rule.value.config.workCalendars['2037-01'] = { sourceVersion: 'fixture-v1', evidenceRef: 'Fictional calendar', days: [{ workDate: '2037-01-05', units: '1' }] };
  return { vm, writes, navigations, scope };
}

test('rule numeric validation attaches each error to its actual field, retaining unconfirmed blanks', async t => {
  const { vm, writes } = await standards(t);
  vm.rule.value.config.normalHourly = 'bad'; vm.rule.value.config.overtime.restday = '-2';
  vm.rule.value.config.paidHourly.absence = '1e2';
  await vm.save();
  assert.match(vm.fields.normalHourly ?? '', /非负/);
  assert.match(vm.fields['overtime.restday'] ?? '', /非负/);
  assert.match(vm.fields['paidHourly.absence'] ?? '', /非负/);
  assert.equal(vm.fields['paidHourly.sick_leave'], undefined);
  assert.equal(writes.length, 0); assert.equal(vm.open.value, true);
});

test('first draft manual performance uses only selected validated candidates and never another month', async t => {
  const { vm, writes } = await standards(t);
  vm.addMapping(); await flush();
  assert.equal(typeof vm.manualPeopleState, 'function', 'draft selection must supply the manual editor');
  assert.deepEqual(vm.manualPeopleState('2037-01').employees.map(person => person.id), ['a']);
  vm.mappings.value[0].manualAmounts = { a: '123.40' }; vm.mappings.value[0].evidenceRef = 'Fictional monthly input';
  await vm.save(); assert.equal(writes.length, 1, JSON.stringify(vm.fields));
  assert.equal(writes[0].config.performance['2037-01'].manualAmounts.a, '123.40');
  assert.equal(vm.manualPeopleState('2037-02').employees.length, 0);
});

test('candidate conflicts, removed selections and pending reload cannot validate manual money', async t => {
  const { vm, writes } = await standards(t);
  vm.addMapping(); await flush();
  vm.rule.value.config.employeeScope.employeeIds = ['b', 'conflict'];
  vm.mappings.value[0].manualAmounts = { a: '100', conflict: '200' }; vm.mappings.value[0].evidenceRef = 'Fictional';
  await vm.save();
  assert.ok(vm.fields['performance.0.manualAmounts.a']); assert.ok(vm.fields['performance.0.manualAmounts.conflict']);
  assert.equal(writes.length, 0);
  vm.rule.value.effectiveFrom = '2037-01-02';
  assert.equal(vm.manualPeopleState('2037-01').loading, true, 'old successful candidates cannot validate a changed effective interval');
});

test('monthly next actions preserve the chosen payer and month, and a saved old draft clears on scope change', async t => {
  const { vm, scope, navigations } = await standards(t);
  vm.nextPage('/payroll/attendance');
  assert.deepEqual(navigations[0], { path: '/payroll/attendance', query: { subjectId: 'subject', month: '2037-01' } });
  vm.savedDraft.value = { kind: 'rule', row: { id: 'old-draft' } };
  scope.month.value = '2037-02'; await flush();
  assert.equal(vm.savedDraft.value, undefined);
});

test('real reconciliation defaults to net even when no reviewed deduction profile exists', async t => {
  const b = { id: 'batch', subjectId: 'subject', month: '2037-01', payMonth: '2037-02', purpose: 'reconciliation', status: 'draft', version: 1, versions: [] };
  const effect = vue.effectScope(); t.after(() => effect.stop());
  const component = load('PayrollBatchDetail.vue', {
    vue: { ...vue, onBeforeUnmount() {} },
    'vue-router': { useRoute: () => ({ params: { id: 'batch' }, query: {} }), useRouter: () => ({}), onBeforeRouteLeave() {}, onBeforeRouteUpdate() {} },
    'element-plus': { ElMessageBox: {} }, '@element-plus/icons-vue': {}, '@/stores/auth.store': { useAuthStore: () => ({ user: { id: 'hr' } }) },
    '@/api/payroll.api': { payrollApi: { batch: async () => b, employees: async () => [], operators: async () => [], deductionProfiles: async () => [] }, payrollError: async e => e.message },
  }).default;
  const vm = effect.run(() => component.setup({ access: { enabled: true, subjects: [{ id: 'subject', capabilities: ['payroll_edit'] }] } }, { expose() {}, emit() {} }));
  await flush(); assert.equal(vm.calculationMode.value, 'net');
  await vm.selectAction('calculate'); assert.equal(vm.action.value, 'calculate');
  await vm.run(); assert.match(vm.fields.value.payDate, /发薪日/);
});

test('reconciliation net rows cannot offer payment even if an outer caller passes canPay', () => {
  const component = load('PayrollNetResults.vue').default;
  const props = { snapshot: { rows: [] }, payments: [], canPay: true, purpose: 'reconciliation' };
  const vm = component.setup(props, { expose() {}, emit() {} });
  assert.equal(vm.canPayRow({ employeeId: 'a', result: { status: 'ready' } }), false);
});

test('parameter comparison includes membership, zero wages, manual pay, calendar, pricing and ordered approval path', () => {
  const { parameterChanges } = load('payroll-workflow-presentation.ts');
  const config = { employeeScope: { employeeIds: ['a'], evidenceRef: 'Scope v1' }, workCalendars: { '2037-01': { sourceVersion: 'v1', evidenceRef: 'Calendar v1', days: [{ workDate: '2037-01-05', units: '1' }] } }, monthlyUnits: {}, normalHourly: '20', paidHourly: {}, overtime: {}, reviewers: ['r1', 'r2'], approvers: ['p'], performance: { '2037-01': { sourceKind: 'manual', manualAmounts: { a: '0.00' }, evidenceRef: 'Pay v1' } } };
  const previous = { effectiveFrom: '2037-01-01', effectiveTo: null, config };
  const next = JSON.parse(JSON.stringify(previous)); next.config.employeeScope.employeeIds = ['b']; next.config.normalHourly = '25';
  next.config.workCalendars['2037-01'].days[0].units = '0.5'; next.config.performance['2037-01'].manualAmounts.a = '80'; next.config.reviewers.reverse();
  const release = { kind: 'rule', previousParameterId: 'old', previousSnapshot: previous, snapshot: next };
  const labels = id => ({ a: 'Fictional A', b: 'Fictional B', r1: 'Reviewer one', r2: 'Reviewer two', p: 'Approver' }[id] ?? '待核人员');
  const text = JSON.stringify(parameterChanges(release, labels));
  for (const value of ['新增', '移除', 'Fictional A', 'Fictional B', '0.00', '80', '工作日日历', '0.5', '20', '25', 'Reviewer one', 'Reviewer two']) assert.ok(text.includes(value), value);
  const standard = parameterChanges({ kind: 'standard', previousParameterId: 'old', previousSnapshot: { fixedMonthly: '0' }, snapshot: { fixedMonthly: '100' } }, labels);
  assert.ok(standard.some(row => row.label === '固定月薪' && row.before === '0' && row.after === '100'));
});

test('comparison distinguishes missing old snapshot from first setup, without inventing zeros', () => {
  const { parameterChanges } = load('payroll-workflow-presentation.ts');
  const release = { kind: 'standard', previousParameterId: 'old', snapshot: { fixedMonthly: '100', performanceBase: null } };
  const text = JSON.stringify(parameterChanges(release)); assert.match(text, /原值未提供/); assert.doesNotMatch(text, /首次配置/);
  const first = JSON.stringify(parameterChanges({ ...release, previousParameterId: null })); assert.match(first, /首次配置/);
});

test('business evidence describes fixed proration, manual pay, deductions and malformed times safely', () => {
  const { payrollEvidenceRows, payrollTime } = load('payroll-workflow-presentation.ts');
  const evidence = { calculated: { amount: '500.00', evidence: { entries: [{ input: { from: '2037-01-01', to: '2037-01-15', fixedMonthly: '1000', units: '10', monthUnits: '20' }, amount: '500.00' }] } }, manualPerformance: { amount: '80.00', evidenceRef: 'Fictional approved' }, adjustment: '0.00', openingBalanceId: 'opening' };
  const text = JSON.stringify(payrollEvidenceRows(evidence));
  for (const value of ['固定月薪', '1000', '10', '20', '500.00', '人工绩效', '80.00', 'Fictional approved']) assert.ok(text.includes(value), value);
  const tax = JSON.stringify(payrollEvidenceRows({ tax: { cumulative: { income: '10000', taxPaid: '100' }, taxableIncome: '5000', carryForwardCredit: '0' } }));
  assert.match(tax, /累计收入/); assert.match(tax, /累计已扣个税/); assert.match(tax, /累计应纳税所得额/);
  assert.equal(payrollTime(null), '时间未记录'); assert.equal(payrollTime('bad date'), '时间未记录');
  assert.match(payrollTime('2037-01-01T00:00:00Z'), /2037.*01.*01.*08:00/);
});

test('timeline uses real audit facts with Chinese actions, Beijing times, version and operator', () => {
  const { payrollTimeline } = load('payroll-workflow-presentation.ts');
  const rows = payrollTimeline([{ action: 'created', actorId: 'hr', createdAt: '2037-01-01T00:00:00Z' }, { action: 'returned', actorId: 'r', createdAt: '2037-01-02T00:00:00Z', version: 2, metadata: { note: 'Fictional return reason' } }, { action: 'future_unknown', metadata: {} }], id => id === 'hr' ? 'Fictional HR' : 'Fictional reviewer');
  assert.match(JSON.stringify(rows), /创建核算批次/); assert.match(JSON.stringify(rows), /退回经办/);
  assert.match(JSON.stringify(rows), /Fictional return reason/); assert.match(JSON.stringify(rows), /Fictional HR/);
  assert.match(JSON.stringify(rows), /V2/); assert.match(JSON.stringify(rows), /其他业务记录/);
  assert.deepEqual(payrollTimeline([]), []);
});

test('review component renders previous and new wages without expanding raw JSON, and honors unavailable reason', t => {
  const base = { kind: 'standard', previousParameterId: 'old', snapshot: { fixedMonthly: '100.00', performanceBase: null, performanceMode: 'additional' }, previousSnapshot: { fixedMonthly: '0.00' } };
  const text = rendered(t, 'PayrollParameterComparison.vue', { release: base });
  assert.match(text, /原值 → 本次提交/); assert.match(text, /0.00/); assert.match(text, /100.00/); assert.match(text, /已变更/);
  const unavailable = rendered(t, 'PayrollParameterComparison.vue', { release: { ...base, previousSnapshot: undefined, comparisonUnavailable: '冻结前版已变化，请核对' } });
  assert.match(unavailable, /冻结前版已变化/); assert.match(unavailable, /原值未提供/); assert.doesNotMatch(unavailable, /首次配置/);
  const { parameterChanges } = load('payroll-workflow-presentation.ts');
  assert.ok(parameterChanges({ ...base, previousSnapshot: undefined }).every(row => row.before === '原值未提供'));
});

test('calculation evidence renders fixed proration and manual pay outside advanced JSON', t => {
  const text = rendered(t, 'PayrollCalculationEvidence.vue', { evidence: { manualPerformance: { amount: '83.21', evidenceRef: 'Fictional approved input' }, calculated: { evidence: { entries: [{ input: { fixedMonthly: '2345', from: '2037-01-01', to: '2037-01-15', units: '8', monthUnits: '20' }, amount: '938.00' }] } } } });
  for (const value of ['固定月薪', '2345', '8 / 20', '938.00', '人工绩效', '83.21', 'Fictional approved input']) assert.ok(text.includes(value), value);
});

test('all owned workflow and presentation SFC templates compile', () => {
  for (const file of ['PayrollStandardsView.vue', 'PayrollParameterReviewsView.vue', 'PayrollBatchDetail.vue', 'PayrollBatchesView.vue', 'PayrollNetResults.vue', 'PayrollParameterComparison.vue', 'PayrollCalculationEvidence.vue', 'PayrollBusinessRecords.vue']) {
    const filename = path.join(root, file), { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
    const script = compileScript(descriptor, { id: file });
    const result = compileTemplate({ source: descriptor.template.content, filename, id: file, compilerOptions: { bindingMetadata: script.bindings } });
    assert.deepEqual(result.errors, [], file);
  }
});

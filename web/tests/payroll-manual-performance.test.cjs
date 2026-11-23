const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');

const filename = path.resolve(__dirname, '../src/views/compensation/payroll/payroll-manual-performance-form.ts');
function load() {
  assert.ok(fs.existsSync(filename), 'manual performance form helper must exist');
  const loaded = new Module(filename, module);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return loaded.exports;
}

test('new monthly input defaults to manual without inventing employee amounts or automatic sources', () => {
  const { newPerformanceMapping } = load();
  assert.deepEqual(newPerformanceMapping('2037-01'), {
    month: '2037-01', sourceKind: 'manual', manualAmounts: {}, evidenceRef: '', cycleIds: [], coefficients: {},
  });
});

test('saving manual amounts omits blanks, preserves explicit zero and does not prorate entered wages', () => {
  const { performanceMappingsPayload } = load();
  const input = [{ month: '2037-01', sourceKind: 'manual', manualAmounts: {
    blank: '', whitespace: '  ', zero: '0', employee: '1234.5', max: '999999999999.99',
  }, evidenceRef: ' fictional HR confirmation ', cycleIds: ['stale-cycle'], coefficients: { A: '2' }, coefficientVersion: 'old' }];
  const before = JSON.stringify(input);
  assert.deepEqual(performanceMappingsPayload(input), { '2037-01': {
    sourceKind: 'manual', manualAmounts: { zero: '0.00', employee: '1234.50', max: '999999999999.99' },
    evidenceRef: 'fictional HR confirmation', cycleIds: [], coefficients: {},
  } });
  assert.equal(JSON.stringify(input), before, 'draft must survive serialization and failed requests unchanged');
});

test('manual validation accepts unconfirmed blanks but requires confirmation evidence', () => {
  const { manualPerformanceErrors } = load();
  const mapping = { manualAmounts: { employee: '', zero: '0.00' }, evidenceRef: 'approved input' };
  assert.deepEqual(manualPerformanceErrors(mapping, ['employee', 'zero']), {});
  assert.ok(manualPerformanceErrors({ ...mapping, evidenceRef: ' ' }, ['employee', 'zero']).evidenceRef);
  assert.deepEqual(manualPerformanceErrors({ evidenceRef: 'pending amounts' }, ['employee']), {});
});

test('manual validation rejects negative, excessive, fractional-cent and non-decimal money beside the employee', () => {
  const { manualPerformanceErrors } = load();
  for (const amount of ['-0.01', '1000000000000', '1.234', '1e2', 'NaN', '1,000', '.50', '+1', '1.']) {
    assert.ok(manualPerformanceErrors({ manualAmounts: { employee: amount }, evidenceRef: 'approved' }, ['employee'])['manualAmounts.employee'], amount);
  }
  for (const amount of ['0', '0.00', '12.3', '999999999999.99']) {
    assert.deepEqual(manualPerformanceErrors({ manualAmounts: { employee: amount }, evidenceRef: 'approved' }, ['employee']), {}, amount);
  }
});

test('manual input cannot submit employee keys outside the selected subject and attribution month', () => {
  const { manualPerformanceErrors } = load();
  const errors = manualPerformanceErrors({ manualAmounts: { current: '10', foreign: '20', blank: '' }, evidenceRef: 'approved' }, ['current']);
  assert.ok(errors['manualAmounts.foreign']);
  assert.equal(errors['manualAmounts.current'], undefined);
  assert.equal(errors['manualAmounts.blank'], undefined);
});

test('copying existing official, fictional and legacy mappings does not convert their source or change their evidence', () => {
  const { performanceMappingsPayload } = load();
  for (const sourceKind of ['official', 'fictional', null, undefined]) {
    const mapping = { cycleIds: ['monthly-cycle'], coefficients: { A: '1.2', B: '' }, sourceKind, coefficientVersion: 'table-v2', evidenceRef: 'official approval' };
    const input = [{ month: '2037-01', ...mapping }];
    assert.deepEqual(performanceMappingsPayload(input)['2037-01'], { ...mapping, coefficients: { A: '1.2' } });
    assert.equal(input[0].coefficients.B, '');
  }
});

test('switching back to an automatic source never sends hidden manual amounts', () => {
  const { performanceMappingsPayload } = load();
  const result = performanceMappingsPayload([{ month: '2037-01', sourceKind: 'official', cycleIds: ['cycle'], coefficients: { A: '1' }, manualAmounts: { employee: '500' } }]);
  assert.equal(result['2037-01'].manualAmounts, undefined);
  assert.equal(result['2037-01'].sourceKind, 'official');
  assert.deepEqual(result['2037-01'].cycleIds, ['cycle']);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
function mountStandards(t, employeesForMonth = () => [{ id: 'employee', name: 'Fictional employee', employeeNo: 'F001' }]) {
  const viewFile = path.resolve(__dirname, '../src/views/compensation/payroll/PayrollStandardsView.vue');
  const { descriptor } = parse(fs.readFileSync(viewFile, 'utf8'));
  const loaded = new Module(viewFile, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(viewFile));
  const original = loaded.require.bind(loaded), writes = [], reads = [], confirmations = [];
  const scope = { subjectId: vue.ref('subject'), month: vue.ref('2037-01'), subjects: vue.ref([]),
    has: () => true, error: vue.ref(''), loading: vue.ref(false), refreshAccess: async () => {} };
  loaded.require = id => {
    if (id === '@/utils/preview-mode') return { isLocalPreview: true };
    if (id === 'vue-router') return { onBeforeRouteLeave() {}, useRoute: () => ({ query: {} }), useRouter: () => ({ push: async () => {} }) };
    if (id === 'element-plus') return { ElMessageBox: { confirm: async message => { confirmations.push(message); throw Error('keep editing'); } } };
    if (id === '@element-plus/icons-vue' || id.endsWith('.vue')) return {};
    if (id === './usePayrollScope') return { usePayrollScope: () => scope };
    if (id === './payroll-manual-performance-form') return load();
    if (id === './payroll-state') return { isDecimal: value => /^\d+(\.\d+)?$/.test(value) };
    if (id === '@/api/payroll.api') return { payrollError: async error => error.message, payrollApi: {
      standards: async () => [], rules: async () => [], operators: async () => [], cycles: async () => [],
      employees: async (subject, month) => { reads.push([subject, month]); return employeesForMonth(month); },
      createRule: async value => { writes.push(value); }, createStandard: async value => { writes.push(value); },
    } };
    if (id.startsWith('./') && fs.existsSync(path.resolve(path.dirname(viewFile), `${id}.ts`))) {
      const file = path.resolve(path.dirname(viewFile), `${id}.ts`), helper = new Module(file, module);
      helper._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
      return helper.exports;
    }
    return original(id);
  };
  loaded._compile(ts.transpileModule(compileScript(descriptor, { id: viewFile }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, viewFile);
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = loaded.exports.default.setup({}, { expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  return { state, scope, writes, reads, confirmations };
}

test('the standards page adds manual monthly wages, retains unsaved-close protection and preserves copied automatic sources', async t => {
  const { state, confirmations } = mountStandards(t); await flush();
  state.edit('rule'); state.addMapping();
  assert.equal(state.mappings.value[0].sourceKind, 'manual');
  assert.equal(state.mappings.value[0].month, '2037-01');
  await state.closeForm(false);
  assert.equal(state.open.value, true); assert.equal(confirmations.length, 1);
  state.edit('rule', { effectiveFrom: '2037-01-01', config: { ...state.rule.value.config, performance: {
    '2037-01': { sourceKind: 'official', cycleIds: ['official-cycle'], coefficients: { A: '1.2' } },
  } } });
  assert.equal(state.mappings.value[0].sourceKind, 'official');
  assert.deepEqual([...state.mappings.value[0].cycleIds], ['official-cycle']);
});

test('the page saves manual wages without cycle/base requirements and excludes unconfirmed blanks', async t => {
  const { state, writes } = mountStandards(t); await flush();
  state.edit('rule'); state.rule.value.effectiveFrom = '2037-01-01';
  state.rule.value.config.workCalendars['2037-01'] = { sourceVersion: 'fictional', evidenceRef: 'approved calendar', days: [{ workDate: '2037-01-15', units: '1' }] };
  state.mappings.value = [{ month: '2037-01', sourceKind: 'manual', manualAmounts: { employee: '0', pending: '' }, evidenceRef: 'HR approved monthly amount', cycleIds: [], coefficients: {} }];
  await flush(); await state.save();
  assert.equal(writes.length, 1, JSON.stringify(state.fields));
  assert.deepEqual(writes[0].config.performance['2037-01'], { sourceKind: 'manual', manualAmounts: { employee: '0.00' }, evidenceRef: 'HR approved monthly amount', cycleIds: [], coefficients: {} });
});

test('each manual attribution month uses its own employee source and out-of-scope input blocks saving', async t => {
  const { state, reads, writes } = mountStandards(t, month => [{ id: month === '2037-01' ? 'january' : 'february', name: 'Fictional', employeeNo: 'F001' }]);
  await flush(); state.edit('rule'); state.rule.value.effectiveFrom = '2037-01-01';
  state.rule.value.config.fixedSalaryBasis = null;
  state.mappings.value = [{ month: '2037-02', sourceKind: 'manual', manualAmounts: { january: '100' }, evidenceRef: 'HR confirmation', cycleIds: [], coefficients: {} }];
  await flush(); await state.save();
  assert.ok(reads.some(([subject, month]) => subject === 'subject' && month === '2037-02'));
  assert.equal(writes.length, 0);
  assert.ok(state.fields['performance.0.manualAmounts.january']);
  assert.equal(state.open.value, true);
});

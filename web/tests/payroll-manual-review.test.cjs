const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

async function renderReview(t, release) {
  const filename = path.resolve(__dirname, '../src/views/compensation/payroll/PayrollParameterReviewsView.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'manual-review-test', genDefaultAs: 'Review' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'manual-review-test', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  const pass = { setup: (_, { slots }) => () => vue.h('div', slots.default?.()) };
  loaded.require = id => {
    if (id === 'element-plus') return { ElMessageBox: {} };
    if (id === 'vue-router') return { onBeforeRouteLeave() {}, onBeforeRouteUpdate() {}, useRoute: () => ({ query: { releaseId: 'release' } }), useRouter: () => ({ push() {} }) };
    if (id === '@/stores/auth.store') return { useAuthStore: () => ({ user: { id: 'manager' } }) };
    if (id === './usePayrollScope') return { usePayrollScope: () => ({ subjectId: vue.ref('subject'), month: vue.ref('2037-01'), subjects: vue.ref([]), error: vue.ref(''), loading: vue.ref(false), refreshAccess: async () => {} }) };
    if (id === '@/api/payroll.api') return { payrollApi: { parameterReleases: async () => [release] }, payrollError: async error => error.message };
    if (id.endsWith('BusinessListPage.vue')) return { setup: (_, { slots }) => () => vue.h('main', slots.detail?.()) };
    if (id.endsWith('.vue')) return pass;
    if (id.startsWith('./') && fs.existsSync(path.resolve(path.dirname(filename), `${id}.ts`))) {
      const file = path.resolve(path.dirname(filename), `${id}.ts`), helper = new Module(file, module);
      helper._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
      return helper.exports;
    }
    return original(id);
  };
  loaded._compile(ts.transpileModule(`${script.content}\n${template.code}\nReview.render = render;\nexport default Review;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  const node = (type, text = '') => ({ type, text, children: [], parent: null });
  const renderer = vue.createRenderer({
    createElement: type => node(type), createText: text => node('#text', text), createComment: () => node('#comment'),
    insert(child, parent, anchor) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child); child.parent = parent;
    },
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1); },
    setText(child, text) { child.text = text; }, setElementText(child, text) { child.text = text; child.children = []; },
    patchProp() {}, parentNode: child => child.parent, nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  });
  const app = renderer.createApp(loaded.exports.default);
  for (const name of ['el-timeline', 'el-timeline-item', 'el-form', 'el-form-item', 'el-input', 'el-button', 'el-alert', 'el-segmented', 'el-table', 'el-table-column', 'el-empty']) app.component(name, pass);
  // Keep the full JSON collapsed, so only the actual review summary can satisfy the assertions.
  app.component('el-collapse', { render: () => null }); app.component('el-collapse-item', pass);
  const root = node('root'); app.mount(root); t.after(() => app.unmount());
  await new Promise(resolve => setImmediate(resolve));
  const text = item => item.text + item.children.map(text).join('');
  return text(root);
}

function release(snapshot, extra = {}) {
  return { id: 'release', kind: 'rule', status: 'pending', parameterVersion: 2, reviewerId: 'manager', submittedById: 'hr',
    reviewer: { name: 'Fictional manager' }, submittedBy: { name: 'Fictional HR' }, submittedAt: '2037-02-01T00:00:00Z',
    snapshot: { effectiveFrom: '2037-01-01', effectiveTo: null, ...snapshot }, ...extra };
}

test('manual review shows employee names, numbers, confirmed wages and evidence without expanding JSON or showing coefficients', async t => {
  const text = await renderReview(t, release({ config: { performance: { '2037-01': {
    sourceKind: 'manual', manualAmounts: { 'employee-uuid': '1234.56', zero: '0.00' }, cycleIds: [], coefficients: {}, evidenceRef: 'Approved fictional monthly wages',
  } } } }, { manualEmployees: [{ id: 'employee-uuid', name: 'Fictional employee', employeeNo: 'F001' }, { id: 'zero', name: 'Zero employee', employeeNo: null }] }));
  assert.ok(text.includes('Fictional employee')); assert.ok(text.includes('F001')); assert.ok(text.includes('1234.56'));
  assert.ok(text.includes('Zero employee')); assert.ok(text.includes('0.00')); assert.ok(text.includes('Approved fictional monthly wages'));
  assert.ok(!text.includes('绩效系数')); assert.ok(!text.includes('employee-uuid'));
});

test('unavailable employee metadata is explicit with only a traceable id suffix', async t => {
  const text = await renderReview(t, release({ config: { performance: { '2037-01': {
    sourceKind: 'manual', manualAmounts: { 'private-prefix-abcdef12': '80.00' }, cycleIds: [], coefficients: {}, evidenceRef: 'Approved',
  } } } }));
  assert.ok(text.includes('记录不可用')); assert.ok(text.includes('abcdef12')); assert.ok(text.includes('80.00'));
  assert.ok(!text.includes('private-prefix'));
});

test('automatic review retains coefficients and null standard base is not mislabeled as inapplicable', async t => {
  const automatic = await renderReview(t, release({ config: { performance: { '2037-01': {
    sourceKind: 'official', cycleIds: ['cycle'], coefficients: { A: '1.2' }, coefficientVersion: 'Approved-v1', evidenceRef: 'Confirmed table',
  } } } }));
  assert.ok(automatic.includes('绩效系数')); assert.ok(automatic.includes('Approved-v1')); assert.ok(automatic.includes('1.2'));
  const standard = await renderReview(t, release({ fixedMonthly: '10000', performanceBase: null, performanceMode: 'additional', evidence: 'Approved fixed wage' }, { kind: 'standard' }));
  assert.ok(standard.includes('未配置（人工金额不使用）'));
});

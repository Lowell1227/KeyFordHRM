const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const vue = require('vue');

function load(filename, source, deps = {}) {
  const m = new Module(filename, module); m.paths = module.paths;
  m.require = id => Object.hasOwn(deps, id) ? deps[id] : require(id);
  m._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return m.exports;
}
const root = path.resolve(__dirname, '../src/views/compensation/payroll');
const file = path.join(root, 'payroll-state.ts');
const state = load(file, fs.readFileSync(file, 'utf8'));
const capabilities = ['payroll_edit', 'payroll_review', 'payroll_approve', 'payroll_export', 'payroll_settle'];
function batch(status = 'calculated') {
  return { id: 'b', subjectId: 's', month: '2026-10', payMonth: '2026-11', purpose: 'reconciliation', status, version: 1,
    versions: [{ id: 'v', version: 1, status, issues: [], gross: '500.00', approvalPath: ['r', 'a'], approvalStep: 0,
      reviewerCount: 1, submittedById: 'hr', lines: [{ status: 'ready', reservation: {} }], netPayments: [] }] };
}
test('real reconciliation only offers recalculation, never any approval, payment or export state', () => {
  for (const status of ['draft', 'calculated', 'pending', 'approved', 'returned', 'withdrawn', 'voided', 'closed']) {
    assert.deepEqual(state.batchActions(batch(status), capabilities, 'r'), ['draft', 'calculated'].includes(status) ? ['calculate'] : [], status);
  }
  assert.deepEqual(state.batchActions(batch(), ['payroll_view'], 'hr'), []);
});
test('real reconciliation is neither a formal payroll nor a fictional export', () => {
  assert.equal(state.purposeLabels.reconciliation, '真实资料对账');
  assert.equal(state.batchStatus(batch()), '对账已计算');
  const incomplete = batch(); incomplete.versions[0].issues = ['待核'];
  assert.equal(state.batchStatus(incomplete), '对账待核对');
  assert.throws(() => state.payrollDownloadName(batch()), /对账/);
});

function view(preview, t) {
  const filename = path.join(root, 'PayrollBatchesView.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'reconciliation', genDefaultAs: 'View' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'reconciliation', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const pass = { setup: (_, { slots }) => () => vue.h('div', slots.default?.()) };
  const component = load(filename, `${script.content}\n${template.code}\nView.render = render;\nexport default View;`.replace(/import\.meta\.env\.VITE_PREVIEW_MODE/g, preview ? "'true'" : "'false'"), {
    vue: { ...vue, onMounted() {} }, 'vue-router': { useRoute: () => ({ params: {}, query: {} }), useRouter: () => ({}) },
    'element-plus': { ElMessageBox: {} }, '@element-plus/icons-vue': {}, '@/api/payroll.api': { payrollApi: {}, payrollError: async e => e.message },
    '@/components/common/business-list/BusinessListPage.vue': { setup: (_, { slots }) => () => vue.h('main', slots.detail?.()) },
    '@/components/common/business-list/BusinessDetailDrawer.vue': pass, '@/components/common/MobileResultCard.vue': pass,
    './PayrollScope.vue': pass, './PayrollLedger.vue': pass, './PayrollReadinessPanel.vue': pass, './payroll-state': state,
    './usePayrollScope': { usePayrollScope: () => ({ access: vue.ref(), subjects: vue.ref([]), subjectId: vue.ref('s'), month: vue.ref('2026-10'), has: () => true, error: vue.ref(''), loading: vue.ref(false), refreshAccess: async () => {} }) },
  }).default;
  const node = (type, text = '') => ({ type, text, children: [], props: {}, parent: null });
  const renderer = vue.createRenderer({
    createElement: type => node(type), createText: text => node('#text', text), createComment: () => node('#comment'),
    insert(child, parent) { parent.children.push(child); child.parent = parent; }, remove() {},
    setText(n, text) { n.text = text; }, setElementText(n, text) { n.text = text; }, patchProp(n, key, _, value) { n.props[key] = value; },
    parentNode: n => n.parent, nextSibling: () => null,
  });
  const options = [];
  const app = renderer.createApp({ setup() { return () => vue.h(component, { mode: 'batches' }); } });
  for (const name of ['el-dialog', 'el-form', 'el-form-item', 'el-select', 'el-button', 'el-alert', 'el-table', 'el-table-column', 'el-tag', 'el-empty']) app.component(name, pass);
  app.component('el-option', { props: ['value', 'label', 'disabled'], setup(props) { options.push(props); return () => null; } });
  app.component('el-date-picker', { render: () => null });
  app.component('RouterView', { render: () => null });
  app.component('RouterLink', pass);
  app.mount(node('root')); t.after(() => app.unmount());
  return options.map(p => ({ value: p.value, label: p.label, disabled: p.disabled }));
}
test('non-preview creation separates real reconciliation and formal; preview keeps only fictional purposes', t => {
  const real = view(false, t), preview = view(true, t);
  assert.deepEqual(real.map(o => o.value).sort(), ['formal', 'reconciliation']);
  assert.equal(real.find(o => o.value === 'reconciliation').label, '真实资料对账');
  assert.equal(real.find(o => o.value === 'formal').disabled, true);
  assert.deepEqual(preview.map(o => o.value).sort(), ['trial', 'validation']);
});

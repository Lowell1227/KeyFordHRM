const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const directory = path.resolve(__dirname, '../src/views/compensation/payroll');
function formHelpers() {
  const filename = path.join(directory, 'payroll-deduction-form.ts'), m = new Module(filename, module);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}
function settings() {
  const s = formHelpers().emptyDeductionSettings(); s.rounding = 'component_half_up';
  for (const kind of ['socialInsurance', 'housingFund']) Object.assign(s[kind], {
    status: 'applicable', ruleVersion: 'fictional', evidenceRef: 'verified contribution rule', contributionDate: '2037-02-01',
    effectiveFrom: '2037-01-01', items: [{ code: 'fictional', base: '1000', rate: '0.01' }],
  });
  Object.assign(s.tax, { method: 'resident_cumulative_wage', ruleVersion: 'fictional-tax', evidenceRef: 'verified tax rule',
    effectiveFrom: '2037-01-01', brackets: [{ upTo: null, rate: '0.05', quickDeduction: '0' }] });
  for (const key of Object.keys(s.tax.current)) { s.tax.current[key] = '0'; s.tax.opening[key] = '0'; s.ledger.priorInPayMonth[key] = '0'; }
  Object.assign(s.tax.opening, { income: '1000', taxPaid: '10', confirmed: true, sourceVersion: 'verified-opening', evidenceRef: 'verified opening' });
  Object.assign(s.ledger, { startDate: '2037-02-01', priorSocialInsurance: '0', priorHousingFund: '0' }); return s;
}
function source() { return { id: 'source', subjectId: 'subject', employeeId: 'alice', payDate: '2037-02-10', version: 2, status: 'active', employee: { name: 'Fictional Alice', employeeNo: 'F001' }, settings: settings() }; }
async function mount(t, file, props = {}, api = {}) {
  const filename = path.join(directory, file), { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: file, genDefaultAs: 'Editor' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: file, compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const m = new Module(filename, module); m.paths = Module._nodeModulePaths(directory); const original = m.require.bind(m);
  const pass = { setup: (_, { slots }) => () => vue.h('div', slots.default?.()) };
  const messages = [], confirm = { reject: false };
  const defaultApi = { deductionProfiles: async () => [source()], employees: async () => [{ id: 'alice', name: 'Fictional Alice', employeeNo: 'F001' }], ...api };
  m.require = id => {
    if (id === 'element-plus') return { ElMessageBox: { confirm: async (...args) => { messages.push(args); if (confirm.reject) throw new Error('cancel'); } } };
    if (id === '@element-plus/icons-vue') return {};
    if (id === 'vue-router') return { useRouter: () => ({ push: async () => {} }), onBeforeRouteLeave() {}, onBeforeRouteUpdate() {} };
    if (id === './usePayrollScope') return { usePayrollScope: () => ({ subjectId: vue.ref('subject'), month: vue.ref('2037-02'), subjects: vue.ref([]), error: vue.ref(''), loading: vue.ref(false), refreshAccess: async () => {} }) };
    if (id === '@/api/payroll.api') return { payrollApi: defaultApi, payrollError: async error => error.message ?? error.response?.data?.message ?? 'request failed' };
    if (id === './payroll-deduction-form') return formHelpers();
    if (id.endsWith('BusinessListPage.vue')) return { setup: (_, { slots }) => () => vue.h('main', [slots.filters?.(), slots.detail?.()]) };
    if (id.endsWith('BusinessDetailDrawer.vue')) return { props: ['modelValue'], setup: (props, { slots }) => () => props.modelValue ? vue.h('aside', [slots.default?.(), slots.footer?.()]) : null };
    if (id.endsWith('.vue')) return pass;
    return original(id);
  };
  m._compile(ts.transpileModule(`${script.content}\n${template.code}\nEditor.render = render;\nexport default Editor;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  const node = (type, text = '') => ({ type, text, children: [], parent: null, props: {}, querySelector: () => null });
  const renderer = vue.createRenderer({
    createElement: type => node(type), createText: text => node('#text', text), createComment: () => node('#comment'),
    insert(child, parent, anchor) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, child); child.parent = parent; },
    remove(child) { child.parent?.children.splice(child.parent.children.indexOf(child), 1); },
    setText(child, text) { child.text = text; }, setElementText(child, text) { child.text = text; child.children = []; },
    patchProp(child, key, _, value) { child.props[key] = value; }, parentNode: child => child.parent, nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  });
  const app = renderer.createApp(m.exports.default, props);
  for (const name of ['el-button', 'el-alert', 'el-select', 'el-option', 'el-form', 'el-input', 'el-date-picker', 'el-checkbox', 'el-segmented', 'el-table', 'el-table-column', 'el-empty']) app.component(name, pass);
  app.component('el-form-item', { props: ['label', 'error'], setup: (p, { slots }) => () => vue.h('div', [p.label, p.error, slots.default?.()]) });
  app.component('el-collapse', { props: ['modelValue'], setup: (p, { slots }) => { vue.provide('expanded', vue.computed(() => p.modelValue)); return () => vue.h('section', slots.default?.()); } });
  app.component('el-collapse-item', { props: ['name', 'title'], setup: (p, { slots }) => { const expanded = vue.inject('expanded'); return () => vue.h('section', [vue.h('h4', p.title), expanded.value.includes(p.name) ? slots.default?.() : null]); } });
  const root = node('root'); app.mount(root); t.after(() => app.unmount()); await new Promise(resolve => setImmediate(resolve));
  const text = item => item.text + item.children.map(text).join('');
  return { vm: app._instance.setupState, text: () => text(root), messages, confirm };
}

test('personal copy shows a locked employee and blocks changing identity even if form state is altered', async t => {
  let saves = 0;
  const view = await mount(t, 'PayrollDeductionProfilesView.vue', {}, { createDeductionProfile: async () => { saves++; return { id: 'new' }; } });
  view.vm.edit(source()); await vue.nextTick();
  assert.ok(view.text().includes('仅复制本员工'));
  view.vm.form.payDate = '2037-03-10'; await view.vm.targetDateChanged();
  view.vm.form.settings = settings(); view.vm.form.employeeId = 'bob'; view.vm.payDateConfirmed = true;
  await view.vm.save(); assert.equal(saves, 0); assert.match(view.vm.fields.employeeId, /不能更换员工/);
});

test('an unknown single save cannot be retried from the form and cancellation retains unsaved edits', async t => {
  let saves = 0, reads = 0;
  const view = await mount(t, 'PayrollDeductionProfilesView.vue', {}, { deductionProfiles: async () => { reads++; return [source()]; }, createDeductionProfile: async () => { saves++; throw new Error('network lost'); } });
  view.vm.edit(); view.vm.form.employeeId = 'alice'; view.vm.form.payDate = '2037-02-10'; view.vm.form.settings = settings();
  view.confirm.reject = true; await view.vm.close(false); assert.equal(view.vm.open, true);
  await view.vm.save(); assert.equal(saves, 1); assert.equal(view.vm.unknownSave, true);
  await view.vm.save(); assert.equal(saves, 1); assert.equal(view.vm.open, true);
  view.confirm.reject = false; await view.vm.close(false); assert.equal(view.vm.open, false);
  assert.ok(reads >= 2, 'returning to verify an uncertain save must refresh the server list');
});

test('single form routes errors to the step being advanced rather than an unrelated later tax error', async t => {
  const view = await mount(t, 'PayrollDeductionProfilesView.vue');
  view.vm.edit(); view.vm.form.employeeId = 'alice'; view.vm.form.payDate = '2037-02-10'; view.vm.step = 'contributions';
  await view.vm.advance(); assert.equal(view.vm.step, 'contributions');
  assert.ok(view.vm.fields['socialInsurance.status']);
});

test('tax groups are collapsed initially except opening, and errors expand their own group', async t => {
  const errors = vue.reactive({});
  const view = await mount(t, 'PayrollDeductionSettingsForm.vue', { modelValue: settings(), section: 'tax', errors });
  assert.ok(view.text().includes('累计收入')); assert.ok(!view.text().includes('个税规则版本')); assert.ok(!view.text().includes('个人社保适用性'));
  errors['tax.brackets.0.rate'] = '请核对税率'; await vue.nextTick(); await vue.nextTick();
  assert.ok(view.text().includes('个税规则版本')); assert.ok(view.text().includes('请核对税率'));
});

test('batch preparation previews all drafts and saves sequentially without submitting or approving them', async t => {
  const people = [{ id: 'alice', name: 'Fictional Alice', employeeNo: 'F001' }, { id: 'bob', name: 'Fictional Bob', employeeNo: 'F002' }], calls = [];
  const view = await mount(t, 'PayrollDeductionBatchEditor.vue', { modelValue: true, subjectId: 'subject', month: '2037-02', employees: people, profiles: [] }, {
    deductionProfiles: async () => [], createDeductionProfile: async input => { calls.push(input.employeeId); return { id: `saved-${input.employeeId}` }; },
    submitParameter: async () => { throw new Error('must not auto-submit'); }, decideParameter: async () => { throw new Error('must not auto-approve'); },
  });
  view.vm.preparation.payDate = '2037-02-10'; view.vm.chosen = ['alice', 'bob']; view.vm.prepare();
  assert.equal(view.vm.phase, 'entry'); assert.deepEqual(calls, []);
  for (const draft of view.vm.drafts) draft.settings = settings();
  view.vm.preview(); assert.equal(view.vm.phase, 'preview'); assert.equal(view.vm.issueCount, 0); assert.deepEqual(calls, []);
  await view.vm.saveAll(); assert.deepEqual(calls, ['alice', 'bob']); assert.equal(view.vm.phase, 'result');
  assert.ok(view.vm.results.every(row => row.status === 'saved'));
});

test('batch save rechecks existing profiles before any creation and keeps conflicts editable', async t => {
  let saves = 0;
  const view = await mount(t, 'PayrollDeductionBatchEditor.vue', { modelValue: true, subjectId: 'subject', month: '2037-02', employees: [{ id: 'alice', name: 'Fictional Alice', employeeNo: 'F001' }], profiles: [] }, {
    deductionProfiles: async () => [source()], createDeductionProfile: async () => { saves++; return { id: 'unexpected' }; },
  });
  view.vm.preparation.payDate = '2037-02-10'; view.vm.chosen = ['alice']; view.vm.prepare(); view.vm.drafts[0].settings = settings(); view.vm.preview();
  await view.vm.saveAll(); assert.equal(saves, 0); assert.equal(view.vm.phase, 'preview'); assert.match(view.vm.rowErrors[0].payDate, /已有资料/);
});

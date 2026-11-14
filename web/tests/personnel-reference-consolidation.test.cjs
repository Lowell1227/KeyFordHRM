const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@vue/compiler-sfc');
const { compileScript } = require('@vue/compiler-sfc');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const axios = require('axios');
const root = path.resolve(__dirname, '../src');

for (const file of ['EmployeeCreateDrawer.vue', 'EmployeeArchiveInlineEditor.vue']) {
  test(`${file} reuses shared reference fields without changing business status controls`, () => {
    const { descriptor } = parse(fs.readFileSync(path.join(root, 'views/admin/components', file), 'utf8'));
    const text = descriptor.template.content;
    const fields = { job_grade: 'form.employee.jobGrade', education: 'form.profile.education',
      marital_status: 'form.profile.maritalStatus', political_status: 'form.profile.politicalStatus',
      household_type: 'form.profile.householdType', contact_relation: 'form.profile.emergencyContactRelation',
      bank_name: 'form.profile.bankName', contract_name: 'contract.name' };
    for (const [kind, binding] of Object.entries(fields)) {
      const controls = [...text.matchAll(/<PersonnelReferenceSelect\b[^>]*>/g)].map(match => match[0]);
      assert.ok(controls.some(control => control.includes(`kind="${kind}"`) && control.includes(`v-model="${binding}"`)), `${kind} must share catalog`);
    }
    assert.match(text, /label="首签" value="contract"/);
    assert.match(text, /label="全职" value="full_time"/);
  });
}

function load(filename, dependencies, source = fs.readFileSync(filename, 'utf8')) {
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = id => id in dependencies ? dependencies[id] : id.startsWith('@/')
    ? load(path.join(root, `${id.slice(2)}.ts`), dependencies) : originalRequire(id);
  loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return loaded.exports;
}
async function mountSelect(t, input, create) {
  const filename = path.join(root, 'components/common/PersonnelReferenceSelect.vue');
  const props = vue.reactive(input), events = [];
  const oldWindow = global.window, oldDocument = global.document;
  global.window = { addEventListener() {}, removeEventListener() {} };
  global.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const component = load(filename, {
    axios,
    '@/api/personnel-reference-data.api': { personnelReferenceDataApi: {
      findAll: async () => [{ id: 'active', name: 'Active', isActive: true }, { id: 'inactive', name: 'Old', isActive: false }], create,
    } },
    '@/stores/auth.store': { useAuthStore: () => ({ user: { sysRole: 'hr' } }) },
  }, compileScript(descriptor, { id: 'reference-select-test' }).content).default;
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = component.setup(props, { emit: (...args) => events.push(args), expose() {} }); return () => null; } });
  app.mount({});
  t.after(() => { app.unmount(); global.window = oldWindow; global.document = oldDocument; });
  await vue.nextTick(); await new Promise(resolve => setImmediate(resolve));
  return { state, props, events };
}

test('shared selector restricts controlled values but keeps free entry for bank suggestions', async t => {
  const { state, props, events } = await mountSelect(t, { kind: 'education', modelValue: 'Old' });
  state.select('Old'); state.select('Unlisted');
  assert.equal(events.length, 0);
  state.select('Active');
  assert.deepEqual(events[0], ['update:modelValue', 'Active']);
  props.kind = 'bank_name'; await vue.nextTick();
  state.select('Custom bank');
  assert.deepEqual(events.at(-1), ['update:modelValue', 'Custom bank']);
});

test('late create response cannot select an education value after switching reference kind', async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { state, props, events } = await mountSelect(t, { kind: 'education', modelValue: '' }, () => pending);
  state.openCreate(); state.name.value = 'Created education';
  const saving = state.save();
  props.kind = 'marital_status'; await vue.nextTick();
  resolve({ id: 'created', kind: 'education', name: 'Created education', isActive: true });
  await saving;
  assert.equal(events.length, 0);
  assert.equal(state.rows.value.some(row => row.kind === 'education'), false);
});

test('reference creation shows the server field validation beside the name without losing input', async t => {
  const { state } = await mountSelect(t, { kind: 'political_status', modelValue: '' }, async () => {
    throw { isAxiosError: true, response: { data: { data: { fieldErrors: { name: '基础资料名称不能使用手机号或身份证号码' } } } } };
  });
  state.openCreate(); state.name.value = 'Synthetic rejected value';
  await state.save();
  assert.equal(state.saveError.value, '基础资料名称不能使用手机号或身份证号码');
  assert.equal(state.name.value, 'Synthetic rejected value');
  assert.equal(state.dialogOpen.value, true);
});

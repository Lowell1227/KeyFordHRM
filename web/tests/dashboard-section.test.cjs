const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const filename = path.resolve(__dirname, '../src/views/dashboard/DashboardSection.vue');
const flush = () => new Promise(resolve => setImmediate(resolve));

function mount(t, input, storage = new Map()) {
  const oldStorage = global.localStorage;
  global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  t.after(() => { if (oldStorage === undefined) delete global.localStorage; else global.localStorage = oldStorage; });
  const auth = vue.reactive({ user: { id: 'one' } });
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const mod = new Module(filename, module); mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = id => id === '@/stores/auth.store' ? { useAuthStore: () => auth } : original(id);
  mod._compile(ts.transpileModule(compileScript(descriptor, { id: filename }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  const props = vue.reactive({ sectionId: 'recruitment', title: '招聘事项', count: null, loading: false, error: '', ...input });
  let state; const events = [];
  const app = renderer.createApp({ setup() { state = mod.exports.default.setup(props, { emit: (...args) => events.push(args), expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); return { state, props, auth, storage, events };
}

test('first settled count chooses default expansion but later arrivals never force an empty section open', async t => {
  const view = mount(t, { count: null, loading: true });
  view.props.loading = false; view.props.count = 0; await flush();
  assert.equal(view.state.expanded.value, false);
  view.props.count = 2; await flush(); assert.equal(view.state.expanded.value, false);
  view.state.toggle(); assert.equal(view.state.expanded.value, true);
  assert.ok([...view.storage.keys()].every(key => key.includes('one') && key.includes('recruitment')));
  assert.deepEqual([...view.storage.values()], ['open']);
});
test('nonempty sections default open, explicit choice survives refresh and does not leak across accounts', async t => {
  const view = mount(t, { count: 3 }); assert.equal(view.state.expanded.value, true);
  view.state.toggle(); view.props.loading = true; await flush(); view.props.loading = false; await flush();
  assert.equal(view.state.expanded.value, false);
  view.auth.user = { id: 'two' }; await flush(); assert.equal(view.state.expanded.value, true);
  view.auth.user = { id: 'one' }; await flush(); assert.equal(view.state.expanded.value, false);
});
test('failed counts remain unknown and errors are outside the collapsible body', async t => {
  const view = mount(t, { count: 4 }); view.state.toggle();
  view.props.count = null; view.props.error = '暂时无法读取'; await flush();
  assert.equal(view.state.expanded.value, false); assert.equal(view.state.countText.value, '暂不可用');
  const source = fs.readFileSync(filename, 'utf8');
  assert.ok(source.indexOf('v-if="error"') < source.indexOf('v-show="expanded"'));
});

test('section priority only changes for settled results, not temporary loading or unknown counts', async t => {
  const view = mount(t, { count: 4 }); view.state.toggle();
  assert.equal(view.state.sectionOrder.value, 0);
  view.props.loading = true; view.props.count = null; await flush();
  assert.equal(view.state.sectionOrder.value, 0);
  assert.equal(view.state.expanded.value, false);
  view.props.loading = false; await flush();
  assert.equal(view.state.sectionOrder.value, 0);
  view.props.count = 0; await flush();
  assert.equal(view.state.sectionOrder.value, 1);
  view.props.loading = true; view.props.error = '暂时无法读取'; await flush();
  assert.equal(view.state.sectionOrder.value, 1);
  view.props.loading = false; await flush();
  assert.equal(view.state.sectionOrder.value, 0);
  assert.equal(view.state.expanded.value, false);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const row = id => ({ id, userId: `user-${id}`, subjectId: `subject-${id}`, capabilities: ['payroll_view'], revokedAt: null, updatedAt: '2037-01-01T00:00:00.000Z',
  user: { id: `user-${id}`, name: `Fictional person ${id}`, employeeNo: `F-${id}` }, subject: { id: `subject-${id}`, name: `Fictional company ${id}`, isActive: true } });
const choices = value => ({ users: [value.user], subjects: [value.subject], capabilities: ['payroll_view'] });

function mount(t) {
  const file = path.resolve(__dirname, '../src/views/system/PayrollGrantsView.vue'), m = new Module(file, module);
  m.paths = Module._nodeModulePaths(path.dirname(file));
  const original = m.require.bind(m), lists = [], optionReads = [], histories = [], writes = [], confirmations = [];
  const auth = vue.reactive({ token: 'session', user: { id: 'admin' } });
  const api = {
    list: () => { const pending = deferred(); lists.push(pending); return pending.promise; },
    options: () => { const pending = deferred(); optionReads.push(pending); return pending.promise; },
    events: id => { const pending = deferred(); histories.push({ id, ...pending }); return pending.promise; },
    save: async value => { writes.push(value); throw new Error('Fictional save conflict'); },
  };
  m.require = name => {
    if (name === 'vue-router') return { onBeforeRouteLeave() {} };
    if (name === 'element-plus') return { ElMessageBox: { confirm: async message => { confirmations.push(message); throw new Error('keep editing'); } } };
    if (name === '@element-plus/icons-vue' || name.endsWith('.vue')) return {};
    if (name === '@/composables/usePagination') return { usePagination: () => ({ page: vue.ref(1), pageSize: vue.ref(20), total: vue.ref(0), skip: vue.ref(0), pageSizeOptions: [20] }) };
    if (name === '@/stores/auth.store') return { useAuthStore: () => auth };
    if (name === '@/api/payroll-grants.api') return { payrollGrantsApi: api };
    if (name === '@/api/payroll.api') return { payrollError: async cause => cause.message };
    if (name === '@/types/payroll-grants.types') return { payrollGrantLabels: { payroll_view: '工资查看' } };
    if (name === './payroll-grants-form') {
      const dependency = path.join(path.dirname(file), 'payroll-grants-form.ts'), helper = new Module(dependency, module);
      helper._compile(ts.transpileModule(fs.readFileSync(dependency, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, dependency);
      return helper.exports;
    }
    return original(name);
  };
  m._compile(ts.transpileModule(compileScript(parse(fs.readFileSync(file, 'utf8')).descriptor, { id: file }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state, mounted = true;
  const app = renderer.createApp({ setup() { state = m.exports.default.setup({}, { expose() {} }); return () => null; } });
  app.mount({});
  const unmount = () => { if (mounted) { mounted = false; app.unmount(); } }; t.after(unmount);
  async function resolveList(index, rows, options = rows.length ? choices(rows[0]) : { users: [], subjects: [], capabilities: ['payroll_view'] }) {
    lists[index].resolve(rows); optionReads[index].resolve(options); await flush();
  }
  return { state, auth, lists, optionReads, histories, writes, confirmations, resolveList, unmount };
}

test('history A cannot overwrite B after closing and reopening the drawer', async t => {
  const f = mount(t); await f.resolveList(0, []);
  const first = f.state.history(row('A')); await f.state.closeDrawer(false); const second = f.state.history(row('B'));
  await flush(); f.histories[1].resolve([{ id: 'event-B' }]); await second;
  f.histories[0].resolve([{ id: 'event-A' }]); await first;
  assert.equal(f.state.selected.value.id, 'B'); assert.deepEqual(f.state.events.value, [{ id: 'event-B' }]);
});

test('late history failure cannot report an error on a new editor or discard its inputs', async t => {
  const f = mount(t), target = row('B'); await f.resolveList(0, [target]);
  const pending = f.state.history(row('A')); await f.state.closeDrawer(false); await f.state.edit(target);
  f.state.draft.value.reason = 'Unsaved fictional basis';
  f.histories[0].reject(new Error('Old history failed')); await pending;
  assert.equal(f.state.formError.value, ''); assert.equal(f.state.eventsLoading.value, false);
  assert.equal(f.state.detail.value, false); assert.equal(f.state.draft.value.reason, 'Unsaved fictional basis');
});

test('old history completion cannot stop B loading or refill a closed drawer', async t => {
  const f = mount(t); await f.resolveList(0, []);
  const first = f.state.history(row('A')); await f.state.closeDrawer(false); const second = f.state.history(row('B'));
  await flush(); f.histories[0].resolve([{ id: 'event-A' }]); await first;
  assert.equal(f.state.eventsLoading.value, true); assert.deepEqual(f.state.events.value, []);
  await f.state.closeDrawer(false); f.histories[1].resolve([{ id: 'event-B' }]); await second;
  assert.equal(f.state.drawer.value, false); assert.deepEqual(f.state.events.value, []);
});

test('unmount invalidates pending history without late component writes', async t => {
  const f = mount(t); await f.resolveList(0, []);
  const pending = f.state.history(row('A')); await flush(); f.unmount();
  f.histories[0].resolve([{ id: 'event-A' }]); await pending;
  assert.deepEqual(f.state.events.value, []);
});

for (const outcome of ['success', 'failure']) test(`an old list ${outcome} cannot replace newer rows and options`, async t => {
  const f = mount(t), current = row('new');
  const refresh = f.state.load(); await f.resolveList(1, [current]); await refresh;
  if (outcome === 'success') await f.resolveList(0, [row('old')]);
  else { f.lists[0].reject(new Error('Old list failed')); f.optionReads[0].resolve(choices(row('old'))); await flush(); }
  assert.deepEqual(f.state.rows.value, [current]); assert.equal(f.state.error.value, '');
  assert.deepEqual(f.state.options.value, choices(current)); assert.equal(f.state.loading.value, false);
});

test('old list completion cannot stop loading the current refresh', async t => {
  const f = mount(t); const refresh = f.state.load();
  await f.resolveList(0, [row('old')]); assert.equal(f.state.loading.value, true);
  await f.resolveList(1, [row('new')]); await refresh;
});

for (const invalid of ['person', 'subject']) test(`a selected inactive ${invalid} retains readable identity and cannot be changed or restored`, async t => {
  const f = mount(t), target = { ...row('A'), revokedAt: '2037-01-01T00:00:00.000Z' };
  await f.resolveList(0, [target]); await f.state.edit(target);
  f.state.draft.value.reason = 'Preserve these unsaved inputs';
  const updatedChoices = choices(target);
  updatedChoices[invalid === 'person' ? 'users' : 'subjects'] = [];
  const refresh = f.state.load(); await f.resolveList(1, [target], updatedChoices); await refresh;
  await f.state.save(); assert.equal(f.writes.length, 0);
  assert.match(f.state.draftBlockReason.value, invalid === 'person' ? /人员/ : /公司/);
  const fallback = (invalid === 'person' ? f.state.userChoices.value : f.state.subjectChoices.value).find(option => option.id === (invalid === 'person' ? target.userId : target.subjectId));
  assert.equal(fallback.name, invalid === 'person' ? target.user.name : target.subject.name); assert.equal(fallback.disabled, true);
  assert.equal(f.state.draft.value.reason, 'Preserve these unsaved inputs');
  f.state.askRevoke({ ...target, revokedAt: null }); assert.equal(f.state.revokeTarget.value.id, target.id);
  f.state.revokeTarget.value = undefined;
  f.state.draft.value.reason = ''; await f.state.closeDrawer(false);
  const history = f.state.history(target); await flush(); f.histories[0].resolve([{ id: 'old-event' }]); await history;
  assert.deepEqual(f.state.events.value, [{ id: 'old-event' }]);
});

test('explicit inactive subject metadata blocks editing even if an older options response still contains it', async t => {
  const f = mount(t), target = { ...row('A'), subject: { ...row('A').subject, isActive: false } };
  await f.resolveList(0, [target]); await f.state.edit(target);
  f.state.draft.value.reason = 'Fictional basis'; await f.state.save(); assert.equal(f.writes.length, 0);
  assert.match(f.state.draftBlockReason.value, /公司/);
});

test('save failures and refused close keep the selected version, capabilities and reason', async t => {
  const f = mount(t), target = row('A'); await f.resolveList(0, [target]); await f.state.edit(target);
  f.state.draft.value.reason = 'Unsaved basis'; const before = JSON.stringify(f.state.draft.value);
  await f.state.save(); assert.equal(f.writes.length, 1);
  assert.equal(JSON.stringify(f.state.draft.value), before); assert.match(f.state.formError.value, /save conflict/);
  await f.state.closeDrawer(false); assert.equal(f.state.drawer.value, true); assert.equal(f.confirmations.length, 1);
});

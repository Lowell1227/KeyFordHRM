const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');

const renderer = vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
const flush = () => new Promise(resolve => setImmediate(resolve));
const impact = (id, version = 'v1') => ({ candidateId: id, version, requiresForce: false, interviews: [], requests: [] });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function dialog(t, api = {}, allowed = true) {
  const filename = path.resolve(__dirname, '../src/views/talent/components/TalentDeleteDialog.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const loaded = new Module(filename, module), writes = [], events = [];
  const deps = {
    vue,
    'element-plus': { ElMessage: { success() {} } },
    '@/api/talent-pool.api': { talentPoolApi: {
      deleteImpact: async id => impact(id),
      remove: async (id, body) => { writes.push({ id, body }); return { id, deleted: true }; }, ...api,
    } },
    '../useTalentPermissions': { useTalentPermissions: () => ({ canEdit: vue.ref(allowed) }) },
  };
  loaded.require = id => deps[id] ?? require(id);
  loaded._compile(ts.transpileModule(compileScript(descriptor, { id: 'delete-test' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  const props = vue.reactive({ modelValue: false, targets: [{ id: 'A', name: '虚构甲' }, { id: 'B', name: '虚构乙' }] });
  let state;
  const app = renderer.createApp({ setup() {
    state = loaded.exports.default.setup(props, { emit: (...args) => events.push(args), expose() {} });
    return () => null;
  } });
  app.mount({}); t.after(() => app.unmount());
  return { props, state, writes, events };
}
async function open(panel) { panel.props.modelValue = true; await flush(); }

test('loads every impact before enabling confirmation; opening and cancelling never delete', async t => {
  const pending = deferred();
  const panel = dialog(t, { deleteImpact: id => id === 'B' ? pending.promise : Promise.resolve(impact(id)) });
  await open(panel);
  assert.equal(panel.state.ready.value, false);
  await panel.state.confirmDelete();
  assert.deepEqual(panel.writes, []);
  pending.resolve(impact('B')); await flush();
  assert.equal(panel.state.ready.value, true);
  panel.props.modelValue = false; await flush();
  await panel.state.confirmDelete();
  assert.deepEqual(panel.writes, []);
});

test('unknown impact blocks the whole confirmation until explicitly refreshed', async t => {
  let fail = true;
  const panel = dialog(t, { deleteImpact: async id => {
    if (id === 'B' && fail) throw Error('offline');
    return impact(id);
  } });
  await open(panel);
  assert.equal(panel.state.ready.value, false);
  assert.ok(panel.state.entries.value[1].error);
  await panel.state.confirmDelete(); assert.deepEqual(panel.writes, []);
  fail = false; await panel.state.loadImpacts();
  assert.equal(panel.state.ready.value, true);
});

test('partial success reports only successful IDs and retries only failures with refreshed impact', async t => {
  const calls = []; let conflict = true;
  const latest = { ...impact('B', 'v2'), requiresForce: true, interviews: [{ id: 'I', status: 'scheduled', version: 1, startsAt: '2035-01-01' }] };
  const panel = dialog(t, { remove: async (id, body) => {
    calls.push({ id, body });
    if (id === 'B' && conflict) throw { response: { status: 409, data: { data: { impact: latest } } } };
    return { id, deleted: true };
  } });
  await open(panel); await panel.state.confirmDelete();
  assert.deepEqual(calls.map(x => x.id), ['A', 'B']);
  assert.deepEqual(panel.events.filter(x => x[0] === 'removed'), [['removed', ['A']]]);
  assert.equal(panel.state.entries.value.length, 1);
  assert.equal(panel.state.entries.value[0].impact.version, 'v2');
  assert.match(panel.state.entries.value[0].error, /变化/);
  assert.equal(panel.state.deletedCount.value, 1);
  conflict = false; await panel.state.confirmDelete();
  assert.deepEqual(calls.map(x => x.id), ['A', 'B', 'B']);
  assert.deepEqual(calls[2].body, { impactVersion: 'v2', force: true });
  assert.ok(panel.events.some(x => x[0] === 'update:modelValue' && x[1] === false));
});

test('failed transport preserves original impact for idempotent DELETE retry and blocks double submit', async t => {
  const pending = deferred(), calls = []; let first = true;
  const panel = dialog(t, { remove: async (id, body) => {
    calls.push({ id, body });
    if (first) { first = false; await pending.promise; throw Error('lost response'); }
    return { id, deleted: true };
  } });
  panel.props.targets = [{ id: 'A', name: '虚构甲' }];
  await open(panel);
  const firstAttempt = panel.state.confirmDelete();
  await panel.state.confirmDelete(); assert.equal(calls.length, 1);
  pending.resolve(); await firstAttempt;
  assert.match(panel.state.entries.value[0].error, /未确认/);
  await panel.state.confirmDelete();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
});

test('closing and reopening discards a stale impact response', async t => {
  const old = deferred(); let reads = 0;
  const panel = dialog(t, { deleteImpact: async id => ++reads === 1 ? old.promise : impact(id, 'fresh') });
  panel.props.targets = [{ id: 'A', name: '虚构甲' }];
  await open(panel); panel.props.modelValue = false; await flush();
  panel.props.targets = [{ id: 'B', name: '虚构乙' }]; await open(panel);
  old.resolve(impact('A', 'old')); await flush();
  assert.equal(panel.state.entries.value[0].id, 'B');
  assert.equal(panel.state.entries.value[0].impact.version, 'fresh');
});

test('review-only HR cannot load deletion impacts or submit', async t => {
  let reads = 0;
  const panel = dialog(t, { deleteImpact: async id => { reads++; return impact(id); } }, false);
  await open(panel); await panel.state.confirmDelete();
  assert.equal(reads, 0); assert.deepEqual(panel.writes, []);
});

test('selected identity stays fixed and closing during a request stops later deletes', async t => {
  const pending = deferred(), calls = [];
  const panel = dialog(t, { remove: async id => { calls.push(id); await pending.promise; return { id, deleted: true }; } });
  await open(panel);
  panel.props.targets = [{ id: 'C', name: '虚构丙' }];
  const deleting = panel.state.confirmDelete();
  assert.deepEqual(calls, ['A']);
  panel.props.modelValue = false; await flush();
  pending.resolve(); await deleting;
  assert.deepEqual(calls, ['A']);
  assert.deepEqual(panel.events.filter(x => x[0] === 'removed'), []);
});

test('selection UI exists on both layouts and detail single delete remains', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/views/talent/TalentListView.vue'), 'utf8');
  assert.match(source, /批量删除/);
  assert.match(source, /aria-label="全选本页"/);
  assert.match(source, /`选择\$\{item.name\}`/);
  const detail = fs.readFileSync(path.resolve(__dirname, '../src/views/talent/components/TalentDetailDrawer.vue'), 'utf8');
  assert.match(detail, /@click="removeCandidate">删除/);
  assert.match(detail, /impactVersion: deleteImpact.value.version/);
});

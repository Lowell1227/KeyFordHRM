const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const { renderToString } = require('@vue/server-renderer');

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
    '../useTalentPermissions': { useTalentPermissions: () => ({ canEdit: vue.ref(allowed), canDelete: vue.ref(allowed) }) },
  };
  loaded.require = id => {
    if (id in deps) return deps[id];
    if (id === '@/types/talent.types' || id === '../interview-time') {
      const dependency = path.resolve(path.dirname(filename), id === '../interview-time'
        ? '../interview-time.ts' : '../../../types/talent.types.ts');
      const compiled = new Module(dependency, module);
      compiled._compile(ts.transpileModule(fs.readFileSync(dependency, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText, dependency);
      return compiled.exports;
    }
    return require(id);
  };
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
  async function html() {
    const template = compileTemplate({ source: descriptor.template.content, filename, id: 'delete-render',
      compilerOptions: { mode: 'function' } });
    assert.deepEqual(template.errors, []);
    const render = new Function('Vue', ts.transpileModule(template.code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText)(vue);
    const component = { setup: () => () => render(vue.proxyRefs(state), []) };
    const output = vue.createSSRApp(component);
    const slotContainer = { setup: (_, { slots }) => () => vue.h('div', [...(slots.default?.() ?? []), ...(slots.footer?.() ?? [])]) };
    output.component('el-dialog', slotContainer);
    output.component('el-button', slotContainer);
    output.directive('loading', {});
    return renderToString(output);
  }
  return { props, state, writes, events, html };
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

test('409 renders changed interview time and intake identity and status before a second explicit delete', async t => {
  const first = { ...impact('B'), requiresForce: true,
    interviews: [{ id: 'I', status: 'scheduled', version: 1, startsAt: '2035-01-01T02:00:00Z' }],
    requests: [{ id: 'request-12345678', onboardingStatus: 'draft', recordStatus: 'draft' }] };
  const latest = { ...first, version: 'v2',
    interviews: [{ ...first.interviews[0], version: 2, startsAt: '2035-01-02T07:00:00Z' }],
    requests: [{ ...first.requests[0], onboardingStatus: 'submitted', recordStatus: 'submitted' }] };
  const calls = [];
  const panel = dialog(t, { deleteImpact: async () => first, remove: async (id, body) => {
    calls.push({ id, body });
    if (calls.length === 1) throw { response: { status: 409, data: { data: { impact: latest } } } };
    return { id, deleted: true };
  } });
  panel.props.targets = [{ id: 'B', name: '虚构乙' }];
  await open(panel);
  const initial = await panel.html();
  assert.match(initial, /2035-01-01 10:00:00/);
  assert.match(initial, /北京时间/);
  assert.match(initial, /待面试/);
  assert.match(initial, /入职申请.*request-.*草稿/s);
  await panel.state.confirmDelete(); await flush();
  assert.equal(calls.length, 1);
  const conflict = await panel.html();
  assert.match(conflict, /2035-01-02 15:00:00/);
  assert.doesNotMatch(conflict, /2035-01-01 10:00:00/);
  assert.match(conflict, /入职申请.*request-.*审核中/s);
  assert.match(conflict, /重新核对/);
  assert.equal(panel.state.ready.value, true);
  assert.deepEqual(panel.events.filter(event => event[0] === 'removed'), []);
  await panel.state.confirmDelete();
  assert.deepEqual(calls, [
    { id: 'B', body: { impactVersion: 'v1', force: true } },
    { id: 'B', body: { impactVersion: 'v2', force: true } },
  ]);
});

test('delete impact renders pending arrival and legacy record status without guessing an intake subtype', async t => {
  const panel = dialog(t, { deleteImpact: async () => ({ ...impact('A'), requests: [
    { id: 'arrival-request', onboardingStatus: 'pending_entry', recordStatus: 'submitted' },
    { id: 'legacy-request', onboardingStatus: null, recordStatus: 'legacy-state' },
  ] }) });
  panel.props.targets = [{ id: 'A', name: '虚构甲' }]; await open(panel);
  const html = await panel.html();
  assert.match(html, /入职申请.*arrival-.*待到岗/s);
  assert.match(html, /入职申请.*legacy-r.*legacy-state/s);
  assert.deepEqual(panel.writes, []);
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

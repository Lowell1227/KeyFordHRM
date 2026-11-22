const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
function hiring(t, query, api = {}) {
  const route = vue.reactive({ query }), requests = [], guards = [];
  const filename = path.join(root, 'views/talent/TalentHiringReviewView.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const source = compileScript(descriptor, { id: filename }).content;
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = id => {
    if (id === 'vue-router') return { useRoute: () => route, onBeforeRouteUpdate: guard => guards.push(guard) };
    if (id === '@/api/talent-recruitment.api') return { recruitmentError: cause => cause.message, talentRecruitmentApi: {
      hiringReviews: async () => [row('first'), row('second')],
      detail: async id => { requests.push(id); return row(id); }, ...api,
    } };
    if (id === '@/types/talent.types' || id === '@/utils/date') return {};
    return original(id);
  };
  loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  let state;
  const app = renderer.createApp({ setup() { state = loaded.exports.default.setup({}, { expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  return { state, route, requests, guards };
}
const row = id => ({ id, candidateName: id, stage: 'hiring_review', revision: 1, allowedActions: ['approve_hiring', 'return_hiring'] });

test('explicit hiring link opens the requested non-first application', async t => {
  const view = hiring(t, { applicationId: 'second' }); await flush();
  assert.deepEqual(view.requests, ['second']); assert.equal(view.state.current.value.id, 'second');
});
test('unavailable explicit target never silently opens queue first', async t => {
  const view = hiring(t, { applicationId: 'missing' }, { detail: async id => { assert.equal(id, 'missing'); throw Error('无权查看'); } }); await flush();
  assert.equal(view.state.current.value, null); assert.equal(view.state.selectedId.value, 'missing'); assert.equal(view.state.detailError.value, '无权查看');
});
test('route switch invalidates delayed old detail and allows explicit queue selection', async t => {
  const old = deferred();
  const view = hiring(t, { applicationId: 'second' }, { detail: id => id === 'second' ? old.promise : Promise.resolve(row(id)) }); await flush();
  assert.equal(view.state.current.value, null); assert.equal(view.state.selectedId.value, 'second');
  view.route.query = { applicationId: 'first' }; await flush();
  old.resolve(row('second')); await flush(); assert.equal(view.state.current.value.id, 'first');
  await view.state.select('second'); assert.equal(view.state.current.value.id, 'second');
});
test('route switch cannot discard an opinion; conflict refresh preserves it', async t => {
  const view = hiring(t, { applicationId: 'second' }); await flush();
  view.state.begin('return_hiring'); view.state.note.value = '需要补充';
  assert.ok(view.guards.length); assert.equal(view.guards[0]({ query: { applicationId: 'first' } }, { query: { applicationId: 'second' } }), false);
  await view.state.select('second', true); assert.equal(view.state.note.value, '需要补充'); assert.equal(view.state.command.value, 'return_hiring');
});
test('ambiguous query refuses to guess an applicant', async t => {
  const view = hiring(t, { applicationId: ['first', 'second'] }); await flush();
  assert.deepEqual(view.requests, []); assert.equal(view.state.current.value, null); assert.ok(view.state.detailError.value);
  await view.state.loadQueue();
  assert.deepEqual(view.requests, []); assert.equal(view.state.current.value, null); assert.ok(view.state.detailError.value);
});
function talentComponent(t, relative, props, query, api = {}) {
  const route = vue.reactive({ query }), guards = [], requests = [];
  const dependencies = {
    'vue-router': { useRoute: () => route, useRouter: () => ({ resolve: () => ({}) }), onBeforeRouteUpdate: guard => guards.push(guard) },
    '@/stores/auth.store': { useAuthStore: () => ({ user: { id: 'actor', sysRole: 'hr' } }) },
    '@/composables/useExport': { useExport: () => ({ loading: vue.ref(false), download() {} }) },
    '@/api/departments.api': { departmentsApi: {} },
    '@/api/talent-pool.api': { talentPoolApi: { list: async query => { requests.push(query); return { items: [], total: 0 }; }, applicationPositions: async () => [] } },
    '@/api/talent-recruitment.api': { recruitmentError: e => e.message, talentRecruitmentApi: { applications: async () => [row('first'), row('second')], ...api } },
    '@/router/navigation': { canAccessRoute: () => true },
  };
  function load(filename, source = fs.readFileSync(filename, 'utf8')) {
    const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = loaded.require.bind(loaded);
    loaded.require = id => {
      if (id in dependencies) return dependencies[id];
      if (id.endsWith('.vue')) return {};
      if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'));
      if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id + '.ts'));
      return original(id);
    };
    loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
    return loaded.exports;
  }
  const filename = path.join(root, relative), { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const component = load(filename, compileScript(descriptor, { id: filename }).content).default;
  let state;
  const app = renderer.createApp({ setup() { state = component.setup(vue.reactive(props), { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); return { state, route, guards, requests };
}
test('candidate links reject ambiguous application instead of selecting first', async t => {
  const view = talentComponent(t, 'views/talent/TalentListView.vue', {}, { candidateId: 'candidate', applicationId: ['first', 'second'] }); await flush();
  assert.equal(view.state.detailVisible.value, false); assert.ok(view.state.deepLinkError.value);
});
test('same-component query updates and removes recruitment filters', async t => {
  const view = talentComponent(t, 'views/talent/TalentListView.vue', {}, {}); await flush();
  view.route.query = { responsibilityScope: 'application', applicationStage: 'accepted' }; await flush();
  assert.equal(view.state.filters.responsibilityScope, 'application'); assert.equal(view.state.filters.applicationStage, 'accepted');
  assert.equal(view.requests.at(-1).applicationStage, 'accepted');
  view.route.query = {}; await flush();
  assert.equal(view.state.filters.responsibilityScope, 'all'); assert.equal(view.state.filters.applicationStage, ''); assert.equal(view.requests.at(-1).applicationStage, undefined);
});
test('candidate application editor blocks route changes that would discard a hiring opinion', async t => {
  const view = talentComponent(t, 'views/talent/components/TalentApplicationPanel.vue', { candidateId: 'candidate', editable: true }, {}); await flush();
  view.state.beginAction('submit_hiring'); view.state.note.value = '原录用意见';
  assert.ok(view.guards.length);
  assert.equal(view.guards[0]({ query: { candidateId: 'candidate', applicationId: 'second' } }, { query: { candidateId: 'candidate', applicationId: 'first' } }), false);
  assert.equal(view.state.note.value, '原录用意见');
});
test('application action and candidate entry use exact IDs, not names', () => {
  const panel = fs.readFileSync(path.join(root, 'views/talent/components/TalentApplicationPanel.vue'), 'utf8');
  assert.match(panel, /path: '\/talent-hiring', query: \{ applicationId: current\.id \}/);
  const list = fs.readFileSync(path.join(root, 'views/talent/TalentListView.vue'), 'utf8');
  assert.match(list, /route\.query\.candidateId/); assert.match(list, /route\.query\.applicationId/);
});

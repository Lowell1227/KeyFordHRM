const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const flush = () => new Promise(resolve => setImmediate(resolve));
const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
function load(file, dependencies) {
  const loaded = new Module(file, module); loaded.paths = module.paths;
  loaded.require = id => {
    if (id in dependencies) return dependencies[id];
    if (id.endsWith('.vue')) return {};
    if (id.startsWith('@/api/')) throw new Error(`Unexpected API: ${id}`);
    if (id.startsWith('@/')) return load(path.join(root, `${id.slice(2)}.ts`), dependencies);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(file), `${id}.ts`), dependencies);
    return require(id);
  };
  let source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.vue')) {
    const { descriptor } = parse(source), script = compileScript(descriptor, { id: file });
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
    source = script.content;
  }
  loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  return loaded.exports;
}
async function queue(t, query, canRead = true) {
  const route = vue.reactive({ query, params: {} }), requests = [], navigations = [];
  const router = { replace: async target => { navigations.push(target); route.query = target.query; }, push: async target => { navigations.push(target); route.query = target.query; } };
  const component = load(path.join(root, 'views/talent/TalentInterviewView.vue'), {
    'vue-router': { useRoute: () => route, useRouter: () => router, onBeforeRouteLeave() {}, onBeforeRouteUpdate() {} },
    './useTalentPermissions': { useTalentPermissions: () => ({ canRead: vue.ref(canRead), canEdit: vue.ref(canRead) }) },
    '@/api/talent-recruitment.api': { recruitmentError: cause => cause.message, talentRecruitmentApi: { queue: async params => { requests.push(params); return { items: [], total: 0 }; } } },
    '@/api/talent-pool.api': { talentPoolApi: {}, talentInterviewsApi: { queue: async () => ({ items: [], total: 0 }) } },
  }).default;
  let state;
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); await flush(); return { state, requests, route, navigations };
}

test('overdue application links keep scope and forward the boolean filter through pagination', async t => {
  const view = await queue(t, { work: 'applications', scope: 'all', overdueOnly: 'true', keyword: 'Fictional' });
  assert.equal(view.requests[0].overdueOnly, true); assert.equal(view.requests[0].scope, 'all');
  view.state.page.value = 2; await view.state.search(false); await flush();
  assert.equal(view.route.query.overdueOnly, 'true'); assert.equal(view.requests.at(-1).page, 2);
  assert.equal(view.requests.at(-1).overdueOnly, true);
});

test('clearing overdue filter removes it while preserving the other queue conditions', async t => {
  const view = await queue(t, { work: 'applications', scope: 'owned', overdueOnly: 'true', stage: 'accepted', keyword: 'Fictional', workbench: 'entry_overdue' });
  await view.state.clearOverdueFilter(); await flush();
  assert.equal(view.route.query.overdueOnly, undefined); assert.equal(view.route.query.scope, 'owned'); assert.equal(view.route.query.stage, 'accepted');
  assert.equal(view.route.query.keyword, 'Fictional'); assert.equal(view.route.query.workbench, 'entry_overdue');
  assert.equal(view.requests.at(-1).overdueOnly, undefined);
  const source = fs.readFileSync(path.join(root, 'views/talent/TalentInterviewView.vue'), 'utf8');
  assert.match(source, /closable[^>]*@close="clearOverdueFilter"[^>]*>预计到岗已过/);
});

test('an interview-only reader never gets the application queue from an overdue link', async t => {
  const view = await queue(t, { work: 'applications', scope: 'all', overdueOnly: 'true' }, false);
  assert.equal(view.state.mode.value, 'interviews'); assert.equal(view.requests.length, 0);
});

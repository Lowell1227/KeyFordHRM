const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const filename = path.join(root, 'views/recruitment/components/RecruitmentDemandApplications.vue');
const flush = () => new Promise(resolve => setImmediate(resolve));
const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
function load(file, dependencies, source = fs.readFileSync(file, 'utf8')) {
  const loaded = new Module(file, module); loaded.paths = module.paths;
  loaded.require = id => {
    if (id in dependencies) return dependencies[id];
    if (id.endsWith('.vue')) return { name: path.basename(id, '.vue') };
    if (id.startsWith('@/api/')) throw new Error(`No unrelated API access: ${id}`);
    if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'), dependencies);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'), dependencies);
    return require(id);
  };
  loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  return loaded.exports;
}
const item = (id = 'application-A', category = 'awaiting_reply') => ({ id, candidateId: `candidate-${id}`, candidateName: 'Fictional candidate',
  positionName: 'Fictional job', stage: 'offered', revision: 2, ownerName: 'Fictional owner', expectedEntryDate: null,
  category, occupied: false, onboardingRequest: null });
async function view(t, implementation, user = { id: 'reader-A', sysRole: 'employee', hrCapabilities: ['recruitment_view'] }) {
  assert.ok(fs.existsSync(filename), 'the demand detail needs its existing-flow application list');
  const calls = [], navigations = [], props = vue.reactive({ demandId: 'demand-A' }), auth = vue.reactive({ user });
  const dependencies = {
    'vue-router': { useRouter: () => ({ push: target => navigations.push(target) }) },
    '@/stores/auth.store': { useAuthStore: () => auth },
    '@/api/recruitment-demands.api': { recruitmentDemandsApi: { applications: async (id, query) => {
      calls.push({ id, ...query }); return implementation ? implementation(id, query) : { items: [item('application-A', query.category)], total: 23, page: query.page, pageSize: query.pageSize };
    } } },
  };
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: filename });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const component = load(filename, dependencies, script.content).default;
  let state;
  const app = renderer.createApp({ setup() { state = component.setup(props, { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); await flush();
  function renderNodes() {
    const rendered = new Module(filename, module);
    rendered.require = () => ({ ...vue, resolveComponent: name => ({ name }), resolveDirective: () => ({}), withDirectives: node => node });
    rendered._compile(ts.transpileModule(template.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
    const setup = vue.proxyRefs(state), tree = rendered.exports.render(setup, [], props, setup, {}, {});
    const row = state.rows.value[0];
    function walk(node) {
      if (Array.isArray(node)) return node.flatMap(walk);
      if (!node || typeof node !== 'object') return [];
      const children = node.children && !Array.isArray(node.children) && typeof node.children === 'object'
        ? Object.values(node.children).filter(slot => typeof slot === 'function').flatMap(slot => slot({ row })) : node.children;
      return [node, ...(typeof children === 'string' ? [] : walk(children))];
    }
    return walk(tree);
  }
  return { state, calls, navigations, props, auth, renderNodes };
}

test('demand applications API encodes the demand id and forwards category pagination without widened timeout', async () => {
  const calls = [];
  const api = load(path.join(root, 'api/recruitment-demands.api.ts'), { './http': { __esModule: true, default: {
    get: async (...args) => { calls.push(args); return { items: [], total: 0 }; },
  } } }).recruitmentDemandsApi;
  assert.equal(typeof api.applications, 'function');
  await api.applications('id/a', { category: 'terminated', page: 3, pageSize: 10 });
  assert.equal(calls[0][0], '/recruitment-demands/id%2Fa/applications');
  assert.deepEqual(calls[0][1], { params: { category: 'terminated', page: 3, pageSize: 10 }, skipErrorMessage: true });
});

test('four server-defined categories reset pagination and retain only the current list', async t => {
  const list = await view(t);
  assert.deepEqual(list.calls, [{ id: 'demand-A', category: 'awaiting_reply', page: 1, pageSize: 10 }]);
  for (const category of ['accepted', 'terminated', 'hired']) {
    list.state.page.value = 3; await list.state.changeCategory(category);
    assert.deepEqual(list.calls.at(-1), { id: 'demand-A', category, page: 1, pageSize: 10 });
    assert.equal(list.state.rows.value[0].category, category);
  }
  list.state.page.value = 2; await list.state.loadList();
  assert.equal(list.calls.at(-1).page, 2); assert.equal(list.calls.at(-1).category, 'hired');
});

test('a list item returns to the exact candidate/application, never inventing a personnel permission', async t => {
  const list = await view(t);
  list.state.openApplication(item());
  assert.deepEqual(list.navigations, [{ path: '/talents', query: { candidateId: 'candidate-application-A', applicationId: 'application-A' } }]);
});

test('unavailable candidates never disclose an old name or navigate, and deletion does not change occupied facts', async t => {
  const row = { ...item(), candidateName: 'MUST-NOT-DISPLAY-OLD-NAME', candidateUnavailable: true, occupied: true };
  const list = await view(t, async () => ({ items: [row], total: 1 }));
  const nodes = list.renderNodes();
  const renderedText = nodes.map(node => typeof node.children === 'string' ? node.children : '').join('');
  assert.ok(renderedText.includes('资料已删除')); assert.ok(renderedText.includes('联系管理员核查'));
  assert.equal(renderedText.includes('MUST-NOT-DISPLAY-OLD-NAME'), false);
  const links = nodes.filter(node => node.type?.name === 'el-button' && node.props?.['aria-label']?.startsWith('查看应聘'));
  assert.equal(links.length, 2);
  for (const link of links) { assert.equal(link.props.disabled, true); assert.equal(link.props['aria-label'].includes('MUST-NOT-DISPLAY-OLD-NAME'), false); }
  list.state.openApplication(row); assert.deepEqual(list.navigations, []);
  assert.equal(list.state.rows.value[0].occupied, true); assert.equal(list.state.total.value, 1);
});

test('a missing name uses a neutral label; the server category remains authoritative after an earlier termination', async t => {
  const row = { ...item(), candidateName: null, stage: 'offered', category: 'awaiting_reply' };
  const list = await view(t, async () => ({ items: [row], total: 1 }));
  assert.equal(list.state.candidateLabel(row), '姓名未提供');
  assert.equal(list.state.rows.value[0].category, 'awaiting_reply');
  assert.equal(list.state.applicationStageLabel(row), '已确认录用');
  assert.equal(list.state.applicationStageLabel({ ...row, stage: 'withdrawn', category: 'terminated' }), '录用已终止');
  assert.equal(list.state.applicationStageLabel({ ...row, stage: 'withdrawn', category: 'accepted' }), '已撤回');
  list.state.openApplication(row); assert.equal(list.navigations.length, 1);
});

test('permission or network failure clears the previous category and has an explicit read-only retry', async t => {
  let failed = false;
  const list = await view(t, async (_id, query) => {
    if (query.category === 'accepted' && !failed) { failed = true; throw { response: { status: 403 } }; }
    return { items: [item('application-B', query.category)], total: 1 };
  });
  await list.state.changeCategory('accepted');
  assert.deepEqual(list.state.rows.value, []); assert.equal(list.state.total.value, 0); assert.match(list.state.error.value, /无权/);
  await list.state.loadList(); assert.equal(list.state.error.value, ''); assert.equal(list.state.rows.value[0].id, 'application-B');
});

test('switching demand/account invalidates late data; a narrow hiring confirmer never reads the list', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const list = await view(t, async id => id === 'demand-A' ? pending : { items: [item('application-B')], total: 1 });
  list.props.demandId = 'demand-B'; await flush();
  release({ items: [item('application-A')], total: 1 }); await flush();
  assert.equal(list.state.rows.value[0].id, 'application-B');
  list.auth.user = { id: 'confirmer', sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] }; await flush();
  assert.deepEqual(list.state.rows.value, []);
  const reads = list.calls.length; await list.state.loadList(); list.state.openApplication(item());
  assert.equal(list.calls.length, reads); assert.deepEqual(list.navigations, []);
});

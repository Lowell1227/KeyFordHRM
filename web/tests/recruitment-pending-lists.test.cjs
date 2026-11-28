const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const handoffFile = path.join(root, 'views/admin/components/OnboardingHandoffList.vue');
const demandFile = path.join(root, 'views/recruitment/RecruitmentDemandsView.vue');
const flush = () => new Promise(resolve => setImmediate(resolve));
const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
function load(filename, dependencies) {
  const loaded = new Module(filename, module); loaded.paths = module.paths;
  loaded.require = id => {
    if (id in dependencies) return dependencies[id];
    if (id.endsWith('.vue')) return { name: path.basename(id, '.vue') };
    if (id.startsWith('@/api/')) throw new Error(`Unexpected broad data API: ${id}`);
    if (id.startsWith('@/')) return load(path.join(root, id.slice(2) + '.ts'), dependencies);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id + '.ts'), dependencies);
    return require(id);
  };
  let source = fs.readFileSync(filename, 'utf8');
  if (filename.endsWith('.vue')) {
    const { descriptor } = parse(source), script = compileScript(descriptor, { id: filename });
    const template = compileTemplate({ source: descriptor.template.content, filename, id: filename,
      compilerOptions: { bindingMetadata: script.bindings } });
    assert.deepEqual(template.errors, []);
    source = script.content;
  }
  loaded._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, filename);
  return loaded.exports;
}
const item = { id: 'app', candidateId: 'candidate', applicationId: 'app', title: 'Synthetic candidate',
  subtitle: 'Synthetic position', date: '2037-01-20' };
async function mount(t, filename, options = {}) {
  const route = vue.reactive({ query: { ...options.query } }), navigations = [], queries = [], details = [];
  const auth = vue.reactive({ user: { id: 'actor', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] } });
  const allowed = vue.ref(options.allowed !== false);
  const router = { push: target => navigations.push(target), replace: async target => {
    navigations.push(target); route.query = Object.fromEntries(Object.entries(target.query).filter(([, value]) => value !== undefined));
  } };
  const dependencies = {
    'vue-router': { useRoute: () => route, useRouter: () => router },
    'element-plus': { ElMessageBox: { confirm: async () => true } },
    '@/stores/auth.store': { useAuthStore: () => auth },
    '@/composables/useVisibleRefresh': { useVisibleRefresh() {} },
    '@/api/talent-recruitment.api': { recruitmentError: error => error.message, talentRecruitmentApi: {
      onboardingHandoff: async query => { queries.push({ ...query }); return options.read ? options.read(query) : { items: [item], total: 41 }; },
    } },
    '@/api/recruitment-demands.api': { recruitmentDemandsApi: {
      list: async query => { queries.push({ ...query }); return { items: [], total: 41 }; },
      status: async () => ({ configured: true }), detail: async id => { details.push(id); return { id, sourceKind: 'local',
        sourceState: 'pending', submittedById: 'another-actor', allowedActions: ['approve', 'return'], issues: [] }; },
    } },
    '../talent/useTalentPermissions': { useTalentPermissions: () => ({ canRead: allowed, canReadDemand: allowed,
      canEdit: vue.ref(false), canReviewDemand: vue.ref(true) }) },
    '@/views/talent/useTalentPermissions': { useTalentPermissions: () => ({ canOnboard: allowed }) },
    '../talent/useRecruitmentLeaveGuard': { useRecruitmentLeaveGuard: () => ({ prepareToLeave: async () => true }) },
  };
  assert.ok(fs.existsSync(filename), 'the narrow handoff component must exist');
  const component = load(filename, dependencies).default;
  let state;
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); await flush();
  return { state, route, router, navigations, queries, details, auth, allowed };
}

test('handoff loads one page, uses the existing shell, and opens only the precise personnel source', async t => {
  const view = await mount(t, handoffFile, { query: { tab: 'handoff', handoffPage: '2', handoffPageSize: '10', keep: 'context' } });
  assert.deepEqual(view.queries, [{ page: 2, pageSize: 10 }]);
  assert.equal(view.state.total.value, 41); assert.equal(view.state.rows.value.length, 1);
  view.state.openOnboarding(item);
  assert.deepEqual(view.navigations.at(-1), { path: '/entry-exit', query: {
    tab: 'handoff', handoffPage: '2', handoffPageSize: '10', keep: 'context', talentId: 'candidate', talentApplicationId: 'app',
    requestId: undefined, applicationId: undefined, employeeId: undefined, assistantRequestId: undefined,
  } });
  const source = fs.readFileSync(handoffFile, 'utf8');
  assert.doesNotMatch(source, /BusinessListPage|talentPoolApi|talentResume|\.detail\(/);
  assert.match(source, /<ListPagination/); assert.match(source, /<MobileResultCard/);
});

test('handoff pagination preserves tab context and browser navigation reloads its own page', async t => {
  const view = await mount(t, handoffFile, { query: { tab: 'handoff', keep: 'context' } });
  view.state.page.value = 3; view.state.pageSize.value = 10; await view.state.changePage(); await flush();
  assert.deepEqual(view.queries.at(-1), { page: 3, pageSize: 10 });
  assert.equal(view.route.query.keep, 'context'); assert.equal(view.route.query.handoffPage, '3');
  view.route.query = { ...view.route.query, handoffPage: '2' }; await flush();
  assert.equal(view.state.page.value, 2); assert.deepEqual(view.queries.at(-1), { page: 2, pageSize: 10 });
});

test('handoff denial, read failures, retries and revoked in-flight results never open broad details', async t => {
  const denied = await mount(t, handoffFile, { allowed: false });
  denied.state.openOnboarding(item); assert.deepEqual(denied.queries, []); assert.deepEqual(denied.navigations, []);
  let attempts = 0;
  const view = await mount(t, handoffFile, { read: async () => { if (!attempts++) throw new Error('Synthetic read failure'); return { items: [item], total: 1 }; } });
  assert.match(view.state.error.value, /Synthetic read failure/); view.state.openOnboarding(item); assert.deepEqual(view.navigations, []);
  await view.state.loadList(); assert.equal(view.state.error.value, ''); assert.equal(view.state.rows.value.length, 1);
  view.allowed.value = false; await flush(); view.state.openOnboarding(item);
  assert.equal(view.state.rows.value.length, 0); assert.deepEqual(view.navigations, []);
  let finish;
  const pending = await mount(t, handoffFile, { read: () => new Promise(resolve => { finish = resolve; }) });
  pending.allowed.value = false; await flush(); finish({ items: [item], total: 1 }); await flush();
  assert.equal(pending.state.rows.value.length, 0);
});

test('demand work queues preserve keyword, state, pagination and the deep-linked original independent actions', async t => {
  const view = await mount(t, demandFile, { query: { workQueue: 'review', keyword: 'Synthetic', status: 'pending', page: '3', pageSize: '10', demandId: 'demand' } });
  assert.deepEqual(view.queries[0], { workQueue: 'review', keyword: 'Synthetic', status: 'pending', page: 3, pageSize: 10 });
  assert.deepEqual(view.details, ['demand']); assert.equal(view.state.canLocalAction('approve'), true);
  assert.equal(view.state.canLocalAction('return'), true); assert.equal(view.state.canLocalAction('edit'), false);
  await view.state.loadList(); assert.equal(view.queries.at(-1).workQueue, 'review');
  view.route.query = { ...view.route.query, workQueue: 'returned', status: 'rejected', page: '2' }; await flush();
  assert.deepEqual(view.queries.at(-1), { workQueue: 'returned', keyword: 'Synthetic', status: 'rejected', page: 2, pageSize: 10 });
});

test('demand searches and pagination keep the selected queue and unrelated deep-link context', async t => {
  const view = await mount(t, demandFile, { query: { workQueue: 'returned', demandId: 'demand', keep: 'context' } });
  view.state.filters.keyword = 'Changed'; view.state.page.value = 3;
  await view.state.search(); await flush();
  assert.equal(view.queries.at(-1).workQueue, 'returned'); assert.equal(view.queries.at(-1).page, 1);
  assert.equal(view.route.query.keyword, 'Changed'); assert.equal(view.route.query.demandId, 'demand');
  view.state.page.value = 2; await view.state.changePage(); await flush();
  assert.equal(view.route.query.workQueue, 'returned'); assert.equal(view.route.query.page, '2');
  assert.equal(view.route.query.keep, 'context');
  await view.state.resetFilters(); await flush();
  assert.equal(view.route.query.workQueue, 'returned'); assert.equal(view.route.query.demandId, 'demand');
  assert.equal(view.queries.at(-1).keyword, undefined);
});

test('demand list API passes workQueue through without adding candidate or resume requests', async () => {
  const calls = [];
  const api = load(path.join(root, 'api/recruitment-demands.api.ts'), { './http': { __esModule: true, default: {
    get: async (...args) => { calls.push(args); return { items: [], total: 0 }; },
  } } }).recruitmentDemandsApi;
  await api.list({ workQueue: 'review', keyword: 'Synthetic', page: 2, pageSize: 10 });
  assert.deepEqual(calls, [['/recruitment-demands', { params: { workQueue: 'review', keyword: 'Synthetic', page: 2, pageSize: 10 }, skipErrorMessage: true }]]);
});

test('demand recruitment progress is a separate persisted filter and resets without losing the review queue', async t => {
  const view = await mount(t, demandFile, { query: { workQueue: 'review', status: 'approved', trackingState: 'paused', keyword: 'Synthetic', page: '2' } });
  assert.equal(view.queries[0].trackingState, 'paused');
  assert.equal(view.queries[0].status, 'approved');
  view.route.query = { ...view.route.query, trackingState: 'filled' }; await flush();
  assert.equal(view.state.filters.trackingState, 'filled'); assert.equal(view.queries.at(-1).trackingState, 'filled');
  await view.state.resetFilters(); await flush();
  assert.equal(view.route.query.workQueue, 'review'); assert.equal(view.queries.at(-1).trackingState, undefined);
});

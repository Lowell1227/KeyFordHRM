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

function loader(dependencies = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = new Module(filename, module);
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, loaded);
    const original = loaded.require.bind(loaded);
    loaded.require = id => {
      if (id in dependencies) return dependencies[id];
      if (id === './http' && filename.endsWith('.api.ts')) return {};
      if (id.endsWith('.vue')) return {};
      if (id.startsWith('@/')) return load(path.join(root, `${id.slice(2)}.ts`));
      if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`));
      return original(id);
    };
    let source = fs.readFileSync(filename, 'utf8');
    if (filename.endsWith('.vue')) source = compileScript(parse(source).descriptor, { id: filename }).content;
    loaded._compile(ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText, filename);
    return loaded.exports;
  }
  return relative => load(path.join(root, relative));
}

function mount(t, setup) {
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = setup(); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  return { state, unmount: () => app.unmount() };
}

function sidebar(t, actor, visible = false, current = { path: '/tasks', query: {} }) {
  const auth = vue.reactive({ user: actor });
  const entitlement = vue.ref(visible);
  const route = vue.reactive({ meta: {}, ...current });
  let routes;
  const resolve = target => {
    const url = new URL(typeof target === 'string' ? target : target.path, 'http://localhost');
    const record = routes.find(row => row.path === url.pathname);
    return { path: url.pathname, query: typeof target === 'string' ? Object.fromEntries(url.searchParams) : target.query,
      matched: record ? [record] : [] };
  };
  const load = loader({ '@/stores/auth.store': { useAuthStore: () => auth },
    '@/composables/useGoalChangeEntry': { useGoalChangeEntry: () => entitlement },
    'vue-router': { useRoute: () => route, useRouter: () => ({ resolve }) } });
  routes = load('router/routes.ts').routes;
  const component = load('components/layout/AppSidebar.vue').default;
  const view = mount(t, () => component.setup({}, { expose() {} }));
  return { ...view, auth, route, entitlement };
}

test('qualified peer menus retain monitor query and dynamic goal-change visibility', async t => {
  const view = sidebar(t, { id: 'fictional-hr', sysRole: 'hr', canViewAll: false });
  const entries = () => view.state.navigation.value.find(row => row.key === 'performance').groups
    .find(row => row.key === 'performance-tasks').items.map(row => [row.label, row.path]);
  assert.deepEqual(entries(), [['绩效任务', '/tasks'], ['目标台账', '/tasks?goalView=monitor']]);
  view.entitlement.value = true;
  assert.deepEqual(entries(), [['绩效任务', '/tasks'], ['目标台账', '/tasks?goalView=monitor'], ['目标变更', '/goal-changes']]);
  view.entitlement.value = false;
  assert.equal(entries().some(([label]) => label === '目标变更'), false);
});

test('ordinary, narrow personnel and assessor users never gain goal-monitor menus', t => {
  for (const actor of [
    { sysRole: 'employee' },
    { sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] },
    { sysRole: 'hr_user', hrCapabilities: ['performance_lifecycle_view'], isAssessorOnly: true },
  ]) {
    const view = sidebar(t, { id: 'fictional-user', canViewAll: false, ...actor });
    const items = view.state.navigation.value.flatMap(row => row.groups.flatMap(group => group.items));
    assert.equal(items.some(row => row.label === '目标台账' || row.label === '目标变更'), false);
  }
});

test('same-path peer highlighting distinguishes the monitor from task tabs and supports change details', t => {
  const view = sidebar(t, { id: 'fictional-hr', sysRole: 'hr' }, true, { path: '/tasks', query: { goalView: 'monitor' } });
  assert.equal(view.state.isMenuActive('/tasks'), false);
  assert.equal(view.state.isMenuActive('/tasks?goalView=monitor'), true);
  view.route.query = { goalView: 'review' };
  assert.equal(view.state.isMenuActive('/tasks'), true);
  assert.equal(view.state.isMenuActive('/tasks?goalView=monitor'), false);
  const { routes } = loader()('router/routes.ts');
  const changes = routes.find(row => row.name === 'GoalChanges');
  const detail = changes.children.find(row => row.name === 'GoalChangeDetail');
  assert.equal(detail.meta.activeNavigationPath, '/goal-changes');
});

test('cycle termination alone opens the existing cycle page without unlocking other management routes', () => {
  const load = loader();
  const { routes } = load('router/routes.ts');
  const { buildNavigation, canAccessRoute } = load('router/navigation.ts');
  const actor = { sysRole: 'hr_user', canViewAll: false, hrCapabilities: ['cycle_terminate'] };
  const cycle = routes.find(row => row.path === '/cycles');
  assert.equal(canAccessRoute(cycle, actor), true);
  const items = buildNavigation(routes, actor).flatMap(row => row.groups.flatMap(group => group.items));
  assert.ok(items.some(row => row.path === '/cycles'));
  for (const path of ['/users', '/entry-exit', '/publish', '/calibration', '/system']) {
    assert.equal(canAccessRoute(routes.find(row => row.path === path), actor), false, path);
  }
  assert.equal(canAccessRoute(cycle, { ...actor, hrCapabilities: [] }), false);
});

test('goal-change consumers share one read and a departing consumer cannot invalidate the others', async t => {
  const auth = vue.reactive({ user: { id: 'fictional-one' } });
  const requests = [];
  const load = loader({ '@/stores/auth.store': { useAuthStore: () => auth },
    '@/api/goal-changes.api': { goalChangesApi: { entry: () => new Promise(resolve => requests.push(resolve)) } } });
  const { useGoalChangeEntry } = load('composables/useGoalChangeEntry.ts');
  const one = mount(t, () => useGoalChangeEntry());
  const two = mount(t, () => useGoalChangeEntry());
  assert.equal(requests.length, 1);
  one.unmount(); requests[0]({ visible: true }); await flush();
  assert.equal(two.state.value, true);
  auth.user = { id: 'fictional-two' }; await flush();
  assert.equal(two.state.value, false);
  assert.equal(requests.length, 2);
  auth.user = null; await flush();
  requests[1]({ visible: true }); await flush();
  assert.equal(two.state.value, false);
});

function goalEntryRefresh(t) {
  const oldWindow = global.window, oldDocument = global.document;
  const window = new EventTarget(), document = new EventTarget(); document.hidden = false;
  global.window = window; global.document = document;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const auth = vue.reactive({ token: 'fictional-session', user: { id: 'fictional-same-account',
    sysRole: 'employee', hrCapabilities: [], businessCapabilities: {} } });
  const reads = [];
  const load = loader({ '@/stores/auth.store': { useAuthStore: () => auth },
    '@/api/goal-changes.api': { goalChangesApi: { entry: () => new Promise((resolve, reject) => reads.push({ resolve, reject })) } } });
  const { useGoalChangeEntry } = load('composables/useGoalChangeEntry.ts');
  const one = mount(t, () => useGoalChangeEntry()), two = mount(t, () => useGoalChangeEntry());
  t.after(() => { global.window = oldWindow; global.document = oldDocument; });
  return { auth, reads, one, two,
    async tick(ms) { now += ms; t.mock.timers.tick(ms); await flush(); },
    async focus() { window.dispatchEvent(new Event('focus')); await flush(); },
    async visibility(hidden) { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); await flush(); },
    async resolve(index, visible) { reads[index].resolve({ visible }); await flush(); },
    async reject(index, status) { reads[index].reject({ response: { status } }); await flush(); },
  };
}

test('same-account grant and revoke are discovered on returning to the foreground, shared once without polling', async t => {
  const h = goalEntryRefresh(t);
  assert.equal(h.reads.length, 1); await h.resolve(0, false);
  await h.tick(1000); await h.visibility(true); await h.tick(60000);
  assert.equal(h.reads.length, 1);
  await h.visibility(false); await h.focus();
  assert.equal(h.reads.length, 2);
  await h.resolve(1, true);
  assert.equal(h.one.state.value, true); assert.equal(h.two.state.value, true);
  h.one.unmount();
  await h.tick(1000); await h.visibility(true); await h.visibility(false); await h.focus();
  assert.equal(h.reads.length, 3);
  await h.resolve(2, false);
  assert.equal(h.two.state.value, false);
  await h.tick(60000); assert.equal(h.reads.length, 3);
});

test('same-account qualification changes invalidate old reads and refresh both consumers without focus', async t => {
  const h = goalEntryRefresh(t); await h.resolve(0, true);
  h.auth.user.hrCapabilities.push('cycle_plan_edit'); await flush();
  assert.equal(h.reads.length, 2);
  assert.equal(h.one.state.value, false); assert.equal(h.two.state.value, false);
  h.auth.user.hrCapabilities = []; await flush();
  assert.equal(h.reads.length, 3);
  await h.resolve(1, true);
  assert.equal(h.two.state.value, false);
  await h.resolve(2, false);
  h.auth.user = { ...h.auth.user }; await flush();
  assert.equal(h.reads.length, 4);
  await h.resolve(3, true);
  assert.equal(h.one.state.value, true); assert.equal(h.two.state.value, true);
});

test('foreground permission errors purge shared eligibility while transport errors preserve the verified result', async t => {
  const h = goalEntryRefresh(t); await h.resolve(0, true);
  await h.tick(1000); await h.focus(); assert.equal(h.reads.length, 2);
  await h.reject(1, 503); assert.equal(h.two.state.value, true);
  await h.tick(1000); await h.focus(); await h.reject(2, 401);
  assert.equal(h.one.state.value, false); assert.equal(h.two.state.value, false);
  await h.tick(1000); await h.focus(); await h.resolve(3, true);
  await h.tick(1000); await h.focus(); await h.reject(4, 403);
  assert.equal(h.one.state.value, false); assert.equal(h.two.state.value, false);
});

test('foreground bursts merge an in-flight read, session changes discard its result, and final disposal removes listeners', async t => {
  const h = goalEntryRefresh(t);
  await h.tick(1000); await h.visibility(true); await h.visibility(false); await h.focus(); await h.focus();
  assert.equal(h.reads.length, 1);
  h.auth.user = { ...h.auth.user, id: 'fictional-other-account' }; await flush();
  assert.equal(h.reads.length, 2);
  await h.resolve(0, true); assert.equal(h.two.state.value, false);
  await h.resolve(1, true); assert.equal(h.two.state.value, true);
  h.auth.token = null; h.auth.user = null; await flush();
  assert.equal(h.one.state.value, false); assert.equal(h.two.state.value, false);
  h.one.unmount(); h.two.unmount();
  await h.tick(60000); await h.focus(); await h.visibility(false);
  assert.equal(h.reads.length, 2);
});

test('a synchronous eligibility-read failure remains closed without breaking consumer setup', async t => {
  const auth = vue.reactive({ user: { id: 'fictional-user' } });
  const load = loader({ '@/stores/auth.store': { useAuthStore: () => auth },
    '@/api/goal-changes.api': { goalChangesApi: { entry: () => { throw { response: { status: 403 } }; } } } });
  const { useGoalChangeEntry } = load('composables/useGoalChangeEntry.ts');
  const view = mount(t, () => useGoalChangeEntry());
  await flush(); assert.equal(view.state.value, false);
});

function dashboard(t, actor) {
  const auth = vue.reactive({ user: actor });
  const pushes = [];
  let routes;
  const load = loader({ '@/stores/auth.store': { useAuthStore: () => auth },
    '@/composables/useVisibleRefresh': { useVisibleRefresh() {} },
    '@/api/workbench.api': { workbenchApi: { operations: async () => ({ groups: {} }) } },
    'vue-router': { useRouter: () => ({ push: target => pushes.push(target),
      resolve: target => ({ meta: routes.find(row => row.path === target.split('?')[0])?.meta ?? {} }) }) } });
  routes = load('router/routes.ts').routes;
  const component = load('views/dashboard/DashboardView.vue').default;
  const view = mount(t, () => component.setup({}, { expose() {} }));
  return { ...view, auth, pushes };
}

test('personnel operator gets existing archive, entry/exit, recruitment and subject-scoped payroll actions without review grants', async t => {
  const view = dashboard(t, { id: 'fictional-operator', sysRole: 'hr_user', canViewAll: false,
    hrCapabilities: ['employee_archive_edit', 'recruitment_edit'], payrollAccess: { enabled: true,
      subjects: [{ id: 'fictional-subject', capabilities: ['payroll_edit', 'attendance_edit', 'attendance_seal', 'payroll_export', 'payroll_settle'] }] } });
  const paths = view.state.roleQuickActions.value.map(row => row.path);
  for (const path of ['/users', '/entry-exit', '/talents', '/recruitment/intakes', '/recruitment/demands', '/talent-interviews',
    '/payroll/standards', '/payroll/attendance', '/payroll/batches', '/payroll/results']) assert.ok(paths.includes(path), path);
  for (const path of ['/entry-exit?tab=reviews', '/approval', '/publish', '/payroll/approvals', '/talent-hiring']) assert.equal(paths.includes(path), false, path);
  view.auth.user.payrollAccess.subjects = []; await flush();
  assert.equal(view.state.roleQuickActions.value.some(row => row.path.startsWith('/payroll/')), false);
});

test('narrow hiring, recruitment-demand and payroll reviewers see only their existing work', t => {
  const cases = [
    [{ sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] }, ['/talent-hiring']],
    [{ sysRole: 'hr_user', hrCapabilities: ['recruitment_demand_review'] }, ['/recruitment/demands']],
    [{ sysRole: 'employee', payrollAccess: { enabled: true, subjects: [{ capabilities: ['payroll_review'] }] } }, ['/payroll/approvals']],
    [{ sysRole: 'employee' }, []],
  ];
  for (const [actor, expected] of cases) {
    const view = dashboard(t, { id: 'fictional-reviewer', canViewAll: false, ...actor });
    assert.deepEqual(view.state.roleQuickActions.value.map(row => row.path), expected);
  }
});

test('common work entries are the first dashboard section, ahead of greetings and task groups', () => {
  const { descriptor } = parse(fs.readFileSync(path.join(root, 'views/dashboard/DashboardView.vue'), 'utf8'));
  const { baseParse } = require('@vue/compiler-dom');
  const ast = baseParse(descriptor.template.content);
  const first = ast.children.find(row => row.type === 1).children.find(row => row.type === 1);
  assert.equal(first.tag, 'section');
  assert.ok(first.props.some(prop => prop.name === 'data-testid' && prop.value?.content === 'dashboard-quick-actions'));
});

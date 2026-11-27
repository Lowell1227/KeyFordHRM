const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function load(filename, deps, source = fs.readFileSync(filename, 'utf8')) {
  const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = id => {
    if (id in deps) return deps[id];
    if (id.endsWith('.vue')) return {};
    if (id.startsWith('@/')) return load(path.join(root, `${id.slice(2)}.ts`), deps);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`), deps);
    return original(id);
  };
  loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return loaded.exports;
}

test('goal-change cleanup link selects original all-related terminated ledger despite an unrelated active pending queue', async t => {
  const route = vue.reactive({ query: { scope: 'all', lifecycleStatus: 'terminated' }, fullPath: '/goal-changes?scope=all&lifecycleStatus=terminated' });
  const queries = [];
  const deps = {
    'vue-router': { useRoute: () => route, useRouter: () => ({ push: async () => {} }) },
    'element-plus': { ElMessage: { error() {} } },
    '@/stores/auth.store': { useAuthStore: () => ({ user: { id: 'viewer', sysRole: 'hr_user', hrCapabilities: ['performance_lifecycle_view'] } }) },
    '@/api/goal-plans.api': { canMonitorGoals: () => true },
    '@/api/performance-lifecycle.api': { canViewLifecycleHistory: () => true, lifecycleLabel: () => '已终止',
      parseLifecycleFilter: value => value === 'terminated' ? value : '' },
    '@/api/goal-changes.api': { goalChangeError: error => error.message, goalChangesApi: {
      context: async () => ({ tasks: [] }),
      page: async query => { queries.push(query); return { items: [{ id: 'retained', allowedActions: [] }], total: 1 }; },
      myPending: async () => [{ id: 'different-active-request', allowedActions: ['decide'] }],
    } },
  };
  const filename = path.join(root, 'views/goal-changes/GoalChangeListView.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const component = load(filename, deps, compileScript(descriptor, { id: filename }).content).default;
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); await flush();
  assert.equal(state.scope.value, 'all'); assert.equal(state.lifecycleStatus.value, 'terminated');
  assert.ok(queries.length); assert.equal(queries[0].scope, 'all'); assert.equal(queries[0].lifecycleStatus, 'terminated');
  assert.deepEqual(state.pageRows.value.map(row => row.id), ['retained']);
  assert.deepEqual(route.query, { scope: 'all', lifecycleStatus: 'terminated' });
});

test('all four cleanup URLs target original registered ledgers and their existing lifecycle filter parser', () => {
  const routes = fs.readFileSync(path.join(root, 'router/routes.ts'), 'utf8');
  for (const url of ['/tasks', '/goal-changes', '/improvement-plans', '/confirmation-applications/manage']) {
    assert.ok(routes.includes(`path: '${url}'`));
  }
  for (const filename of ['views/task/components/GoalPlanList.vue', 'views/goal-changes/GoalChangeListView.vue',
    'views/improvement-plans/ImprovementPlanListView.vue', 'views/confirmation/ConfirmationManageView.vue']) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.match(source, /parseLifecycleFilter\(route\.query\.lifecycleStatus\)/);
    assert.match(source, /lifecycleStatus: lifecycleStatus\.value/);
  }
});

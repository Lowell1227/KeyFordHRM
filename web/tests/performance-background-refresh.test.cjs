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
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function load(filename, dependencies, source = fs.readFileSync(filename, 'utf8')) {
  const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = id => {
    if (id in dependencies) return dependencies[id];
    if (id.endsWith('.vue')) return {};
    if (id.startsWith('@/')) return load(path.join(root, `${id.slice(2)}.ts`), dependencies);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`), dependencies);
    return original(id);
  };
  loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return loaded.exports;
}
function mount(t, relative, input = {}, overrides = {}) {
  const refreshers = [], replacements = [], events = [];
  const auth = vue.reactive({ user: { id: 'reviewer', sysRole: 'hr', hrCapabilities: ['performance_approval'] }, isManager: false });
  const route = vue.reactive({ query: { goalView: 'review', cycleId: 'cycle' }, fullPath: '/tasks?goalView=review' });
  const dependencies = {
    '@/composables/useVisibleRefresh': { useVisibleRefresh: options => refreshers.push(options) },
    '@/stores/auth.store': { useAuthStore: () => auth },
    'vue-router': { useRoute: () => route, useRouter: () => ({ push: async () => {}, replace: async target => replacements.push(target) }) },
    'element-plus': { ElMessage: { success() {}, warning() {}, error() {} }, ElMessageBox: { confirm: async () => {} } },
    '@/api/goal-plans.api': { canMonitorGoals: () => true, GOAL_STEP_LABELS: {}, goalPlansApi: {
      options: async () => ({ cycles: [], departments: [] }), findAll: async () => ({ items: [{ id: 'old' }], total: 1 }) } },
    '@/api/cycles.api': { cyclesApi: { findMine: async () => [], findAll: async () => ({ items: [{ id: 'cycle', createdAt: '2026-11-26', status: 'active' }], total: 1 }) } },
    '@/api/departments.api': { departmentsApi: { findAll: async () => [] } },
    '@/api/tasks.api': { tasksApi: { findMine: async () => ({ items: [], total: 0 }), findTeam: async () => ({ counts: { pending: 1, all: 1 } }) } },
    '@/api/improvement-plans.api': { improvementPlansApi: { myPending: async () => [] } },
    '@/api/goal-changes.api': { goalChangesApi: { myPending: async () => [] } },
    '@/api/approval.api': { approvalApi: { getApprovalList: async () => [{ id: 'old' }], getOverview: async () => ({ total: 1 }) } },
    ...overrides,
  };
  const filename = path.join(root, relative), { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const component = load(filename, dependencies, compileScript(descriptor, { id: relative }).content).default;
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  const props = vue.reactive(input); let state;
  const app = renderer.createApp({ setup() { state = component.setup(props, { emit: (...args) => events.push(args), expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  return { state, auth, props, route, replacements, events, refreshers };
}
test('goal background load keeps current rows, filters and route while pending; reports failures without a false zero', async t => {
  let read = async () => ({ items: [{ id: 'old' }], total: 1 });
  const view = mount(t, 'views/task/components/GoalPlanList.vue', { scope: 'review', allowed: true }, {
    '@/api/goal-plans.api': { GOAL_STEP_LABELS: {}, goalPlansApi: { options: async () => ({ cycles: [], departments: [] }), findAll: () => read() } },
  }); await flush(); const count = view.replacements.length;
  assert.equal(view.refreshers.length, 1);
  const pending = deferred(); read = () => pending.promise;
  const refreshing = view.refreshers[0].refresh(() => true);
  assert.deepEqual(view.state.items.value, [{ id: 'old' }]); assert.equal(view.state.loading.value, false);
  assert.equal(view.replacements.length, count);
  view.state.employeeName.value = 'unsaved filter';
  assert.equal(view.refreshers[0].blocked(), true);
  pending.resolve({ items: [{ id: 'new' }], total: 2 }); await refreshing;
  assert.deepEqual(view.state.items.value, [{ id: 'old' }]);
  view.state.employeeName.value = ''; read = async () => { throw Error('offline'); };
  await view.refreshers[0].refresh(() => true); assert.ok(view.state.error.value);
  assert.deepEqual(view.state.items.value, [{ id: 'old' }]); assert.equal(view.state.total.value, 1);
  assert.equal(view.events.length, 0, 'a cycle-filtered count must not replace the global pending badge');
});
test('goal permission loss invalidates in-flight rows and options, including scope changes', async t => {
  const pending = deferred(); let first = true;
  const view = mount(t, 'views/task/components/GoalPlanList.vue', { scope: 'review', allowed: true }, {
    '@/api/goal-plans.api': { GOAL_STEP_LABELS: {}, goalPlansApi: { options: async () => ({ cycles: [{ id: 'cycle' }], departments: [] }),
      findAll: () => first ? (first = false, Promise.resolve({ items: [{ id: 'old' }], total: 1 })) : pending.promise } },
  }); await flush(); assert.equal(view.refreshers.length, 1);
  const reading = view.refreshers[0].refresh(() => true); view.props.allowed = false; await flush();
  pending.resolve({ items: [{ id: 'forbidden' }], total: 1 }); await reading;
  assert.deepEqual(view.state.items.value, []); assert.deepEqual(view.state.options.value.cycles, []);
});
test('approval background update preserves selections, dialogs, notes and page; rejects stale or forbidden results', async t => {
  let read = async () => [{ id: 'old' }];
  const view = mount(t, 'views/approval/ApprovalView.vue', {}, {
    '@/api/approval.api': { approvalApi: { getApprovalList: () => read(), getOverview: async () => ({ total: 1 }) } },
  }); await flush(); assert.equal(view.refreshers.length, 1);
  view.state.selectedTaskIds.value = ['old']; assert.equal(view.refreshers[0].blocked(), true);
  view.state.selectedTaskIds.value = []; view.state.rejectDialog.value.visible = true;
  view.state.rejectDialog.value.comment = 'keep my reason'; assert.equal(view.refreshers[0].blocked(), true);
  view.state.rejectDialog.value.visible = false; view.state.page.value = 3;
  const pending = deferred(); read = () => pending.promise;
  const reading = view.refreshers[0].refresh(() => true);
  assert.deepEqual(view.state.tasks.value, [{ id: 'old' }]); assert.equal(view.state.loading.value, false);
  view.state.selectedTaskIds.value = ['old']; pending.resolve([{ id: 'new' }]); await reading;
  assert.deepEqual(view.state.tasks.value, [{ id: 'old' }]); assert.equal(view.state.page.value, 3);
  assert.equal(view.state.rejectDialog.value.comment, 'keep my reason');
  view.state.selectedTaskIds.value = []; read = async () => { throw Error('offline'); };
  await view.refreshers[0].refresh(() => true); assert.deepEqual(view.state.tasks.value, [{ id: 'old' }]); assert.ok(view.state.listError.value);
  read = async () => { throw { response: { status: 403, data: { message: 'denied' } } }; };
  await view.refreshers[0].refresh(() => true); assert.deepEqual(view.state.tasks.value, []);
  assert.equal(view.refreshers[0].enabled(), false);
});
test('workbench refresh is focus-only, preserves selected plan and never shows failed goal count as zero', async t => {
  let fail = false;
  const view = mount(t, 'views/dashboard/DashboardTaskEntries.vue', {}, {
    '@/api/goal-plans.api': { canMonitorGoals: () => true, goalPlansApi: { findAll: async () => {
      if (fail) throw Error('offline'); return { total: 2 };
    } } },
    '@/api/tasks.api': { tasksApi: { findMine: async () => ({ items: [{ id: 'task', cycleId: 'cycle', status: 'self_eval' }], total: 1 }) } },
  }); await flush(); assert.equal(view.refreshers.length, 1); assert.equal(view.refreshers[0].intervalMs, 0);
  view.state.selectedPlanId.value = 'cycle'; fail = true;
  await view.refreshers[0].refresh(() => true);
  assert.equal(view.state.selectedPlanId.value, 'cycle'); assert.equal(view.state.goalReviewTotal.value, null);
  assert.equal(view.state.goalReviewError.value, true); assert.equal(view.state.loading.value, false);
});
test('empty goal lists can discover a new item without replacing the URL or resetting pagination', async t => {
  let items = [];
  const view = mount(t, 'views/task/components/GoalPlanList.vue', { scope: 'review', allowed: true }, {
    '@/api/goal-plans.api': { GOAL_STEP_LABELS: {}, goalPlansApi: { options: async () => ({ cycles: [], departments: [] }),
      findAll: async () => ({ items, total: items.length }) } },
  }); await flush(); const count = view.replacements.length;
  assert.deepEqual(view.state.items.value, []);
  items = [{ id: 'incoming' }]; await view.refreshers[0].refresh(() => true);
  assert.deepEqual(view.state.items.value, items); assert.equal(view.replacements.length, count);
  assert.equal(view.events.length, 0, 'filtered cycle totals are not global totals');
});
test('only unfiltered review totals can update the global goal-review badge', async t => {
  const view = mount(t, 'views/task/components/GoalPlanList.vue', { scope: 'review', allowed: true });
  await flush(); view.state.cycleId.value = ''; await view.state.load();
  assert.deepEqual(view.events.at(-1), ['refreshed', 1]); const count = view.events.length;
  view.state.employeeName.value = 'no matching name'; await view.state.load();
  assert.equal(view.events.length, count);
});
test('workbench rejects late responses after identity changes and purges forbidden cached data', async t => {
  const pending = deferred(); let read = async () => ({ items: [{ id: 'old', cycleId: 'cycle', status: 'self_eval' }], total: 1 });
  const view = mount(t, 'views/dashboard/DashboardTaskEntries.vue', {}, {
    '@/api/tasks.api': { tasksApi: { findMine: () => read() } },
  }); await flush(); read = () => pending.promise;
  const refreshing = view.refreshers[0].refresh(() => true); view.auth.user = null; await flush();
  pending.resolve({ items: [{ id: 'forbidden', cycleId: 'cycle', status: 'self_eval' }], total: 1 }); await refreshing;
  assert.deepEqual(view.state.personalTasks.value, []);
  read = async () => { throw { response: { status: 403 } }; };
  view.auth.user = { id: 'next', sysRole: 'employee', hrCapabilities: [] }; await flush();
  assert.deepEqual(view.state.personalTasks.value, []); assert.equal(view.state.personalError.value, true);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };
const failure = status => ({ response: { status, data: { message: 'Do not display unverified response content' } } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function load(file, deps, source = fs.readFileSync(file, 'utf8')) {
  const m = new Module(file, module); m.paths = Module._nodeModulePaths(path.dirname(file));
  const original = m.require.bind(m);
  m.require = id => id in deps ? deps[id] : id.endsWith('.vue') ? {}
    : id.startsWith('@/') ? load(path.join(root, `${id.slice(2)}.ts`), deps)
    : id.startsWith('.') ? load(path.resolve(path.dirname(file), `${id}.ts`), deps) : original(id);
  m._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  return m.exports;
}
function mount(t, relative, input, deps) {
  const file = path.join(root, relative);
  const component = load(file, deps, compileScript(parse(fs.readFileSync(file, 'utf8')).descriptor, { id: file }).content).default;
  const props = vue.reactive(input), events = [];
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  return { state, props, events, unmount: () => app.unmount() };
}
const taskDetail = id => ({ id, cycleId: 'cycle', employeeId: 'employee', managerId: 'manager',
  status: 'indicator_drafting', goalWorkflowVersion: 2, lifecycleStatus: 'active', updatedAt: '2038-01-01', indicatorInstances: [], periods: [] });
function fixture(t, options = {}) {
  const reads = [], writes = [], feedback = [], cleared = [];
  const auth = vue.reactive({ user: { id: 'employee', sysRole: 'employee' } });
  const deps = {
    '@/stores/auth.store': { useAuthStore: () => auth },
    '@/api/performance-lifecycle.api': {
      lifecycleReadOnly: value => value.lifecycleStatus && value.lifecycleStatus !== 'active', lifecycleLabel: () => '已终止',
      performanceLifecycleApi: { detail: async (...args) => {
        reads.push(['lifecycle', ...args]);
        return options.lifecycle ? options.lifecycle(...args) : { lifecycleStatus: 'terminated', terminatedAt: '2038-01-02', terminationReason: '虚构终止原因' };
      } },
    },
    'element-plus': { ElMessage: Object.fromEntries(['error', 'success', 'warning'].map(key => [key, text => feedback.push(text)])),
      ElMessageBox: { confirm: async () => {}, prompt: async () => ({ value: 'reason' }) } },
    '@/api/upload.api': { uploadApi: {} },
  };
  const failWrite = async (...args) => { writes.push(args); throw failure(options.status ?? 409); };
  return { reads, writes, feedback, cleared, auth, deps, failWrite };
}
async function taskView(t, options = {}) {
  const f = fixture(t, options);
  const route = vue.reactive({ name: 'TaskDetail', params: { id: 'A' }, query: {}, fullPath: '/tasks/A?stage=goal-setting' });
  const store = vue.reactive({ loading: false, detail: null, async fetchDetail(id) { f.reads.push(['task', id]); this.detail = taskDetail(id); return this.detail; }, clear() { this.detail = null; } });
  const bool = value => vue.ref(value);
  Object.assign(f.deps, {
    'vue-router': { useRoute: () => route, useRouter: () => ({ push() {} }) },
    '@/stores/task.store': { useTaskStore: () => store },
    '@/composables/usePermission': { usePermission: () => ({ isTaskSelf: bool(true), isTaskManager: bool(false), isAdminLike: bool(false), canEditSelfEval: bool(true) }) },
    '@/composables/useTaskFlow': { useTaskFlow: () => ({ actions: bool({}) }) },
    '@/api/cycles.api': { cyclesApi: { findOne: async () => ({ id: 'cycle' }) } },
    '@/api/tasks.api': { tasksApi: { setIndicators: options.write ?? f.failWrite, submitSelfEval: options.write ?? f.failWrite,
      updateActualValues: options.actualWrite ?? f.failWrite } },
  });
  const view = mount(t, 'views/task/TaskDetailView.vue', {}, f.deps);
  await flush();
  view.state.indicatorSnapshotRef.value = { clearSelfEvalDraft: () => f.cleared.push(true) };
  return { ...f, ...view, route, store };
}
async function workspace(t, role, options = {}) {
  const f = fixture(t, options);
  const detail = id => ({ period: { id, taskId: 'A', periodKey: '2038-01', periodEnd: '2038-01-31', draftVersion: 2,
    selfGrade: null, managerGrade: null, employeeSubmittedAt: '2038-02-01' }, context: { cycleName: 'Fictional' },
    permissions: { canEditEmployee: true, canEditManager: true }, indicators: [{ indicatorVersionItemId: 'goal', weight: 1,
      isScoreRequired: true, selfScore: 80, managerScore: null, progress: 40, healthStatus: null, employeeComment: 'saved', managerComment: '' }] });
  f.deps['@/api/period-reviews.api'] = { periodReviewsApi: {
    findOne: async id => { f.reads.push(['review', id]); return detail(id); },
    saveEmployeeDraft: options.write ?? f.failWrite, submitEmployeeReview: options.write ?? f.failWrite,
    saveManagerDraft: options.write ?? f.failWrite, submitManagerReview: options.write ?? f.failWrite, returnManagerReview: options.write ?? f.failWrite,
  } };
  const view = mount(t, `views/task/components/${role}PeriodReviewWorkspace.vue`, { periodId: 'period-A', taskId: options.standalone ? undefined : 'A' }, f.deps);
  await flush();
  assert.equal(view.state.loading.value, false, 'authorized review load must finish before editing');
  const row = view.state.formItems[0];
  assert.ok(row, 'authorized review must populate its indicator form');
  row[role === 'Employee' ? 'employeeComment' : 'managerComment'] = 'UNSAVED';
  if (role === 'Employee') view.state.overallGrade.value = 'B';
  else { row.managerScore = 88; view.state.managerGrade.value = 'B'; }
  return { ...f, ...view, row };
}

test('goal 409 verifies lifecycle and locks the existing editor without replacing task/instances', async t => {
  const f = await taskView(t), original = f.state.task.value;
  await f.state.handleSaveIndicators({ action: 'save', instances: [{}] });
  assert.equal(f.state.task.value, original);
  assert.equal(f.state.canEditIndicators.value, true, 'do not switch away from the unsaved goal editor');
  assert.equal(f.state.writeBlocked.value, true);
  assert.match(f.state.writeNotice.value, /已终止.*不能保存或提交/);
  assert.ok(f.reads.some(row => row[0] === 'task' && row[1] === 'A'));
  assert.equal(f.reads.filter(row => row[0] === 'task').length, 1);
  assert.deepEqual(f.reads.at(-1), ['lifecycle', 'task', 'A']);
  await f.state.handleSaveIndicators({ action: 'submit', instances: [{}] });
  assert.equal(f.writes.length, 1);
});

test('self evaluation preserves the existing device draft and reports verified termination instead of retry', async t => {
  const f = await taskView(t);
  await f.state.handleSubmitSelfEval({}, []);
  assert.deepEqual(f.cleared, []);
  assert.equal(f.state.writeBlocked.value, true);
  assert.match(f.state.writeNotice.value, /已终止/);
  assert.doesNotMatch(f.feedback.join(' '), /稍后重试/);
  await f.state.handleSubmitSelfEval({}, []);
  assert.equal(f.writes.length, 1);
});

for (const role of ['Employee', 'Manager']) for (const action of ['saveDraft', 'submitReview', ...(role === 'Manager' ? ['returnReview'] : [])]) {
  test(`${role} ${action} preserves unsaved monthly inputs after verified termination; no reload or success event`, async t => {
    const f = await workspace(t, role);
    await f.state[action]();
    assert.equal(f.state.formItems[0], f.row);
    assert.equal(f.row[role === 'Employee' ? 'employeeComment' : 'managerComment'], 'UNSAVED');
    assert.equal(f.state.writeBlocked.value, true);
    assert.match(f.state.writeNotice.value, /已终止/);
    assert.equal(f.reads.filter(row => row[0] === 'review').length, 1);
    assert.deepEqual(f.events, []);
    await f.state[action]();
    assert.equal(f.writes.length, 1);
  });
}

test('an ordinary version conflict is not termination and preserves all form values', async t => {
  const f = await workspace(t, 'Employee', { lifecycle: async () => ({ lifecycleStatus: 'active' }) });
  await f.state.saveDraft();
  assert.equal(f.state.writeBlocked.value, false);
  assert.match(f.state.writeNotice.value, /版本|变化/);
  assert.doesNotMatch(f.state.writeNotice.value, /已终止/);
  assert.equal(f.row.employeeComment, 'UNSAVED');
});

test('standalone employee entry resolves the task from the already-authorized review without stranding loading', async t => {
  const f = await workspace(t, 'Employee', { standalone: true });
  assert.equal(f.state.loading.value, false);
  assert.equal(f.state.canEdit.value, true);
  await f.state.saveDraft();
  assert.deepEqual(f.reads.at(-1), ['lifecycle', 'task', 'A']);
  assert.equal(f.row.employeeComment, 'UNSAVED');
});

for (const status of [401, 403, 404]) test(`409 then lifecycle ${status} fails closed, preserving inputs without disclosing extra metadata`, async t => {
  const f = await workspace(t, 'Employee', { lifecycle: async () => { throw failure(status); } });
  await f.state.saveDraft();
  assert.equal(f.state.writeBlocked.value, true);
  assert.equal(f.state.writeEnded.value, false);
  assert.doesNotMatch(f.state.writeNotice.value, /Do not display|虚构终止原因|已终止/);
  assert.equal(f.row.employeeComment, 'UNSAVED');
  await f.state.saveDraft();
  assert.equal(f.writes.length, 1);
});

test('409 with an unavailable lifecycle check blocks retries without claiming termination', async t => {
  const f = await workspace(t, 'Employee', { lifecycle: async () => { throw Error('offline'); } });
  await f.state.saveDraft();
  assert.equal(f.state.writeBlocked.value, true);
  assert.match(f.state.writeNotice.value, /无法核实任务状态/);
  assert.doesNotMatch(f.state.writeNotice.value, /已终止/);
  assert.equal(f.row.employeeComment, 'UNSAVED');
});

test('self-evaluation termination after actual-value save does not clear the draft or mutate indicator inputs', async t => {
  const f = await taskView(t, { actualWrite: async () => ({ updatedAt: '2038-01-02' }) });
  const instances = f.state.task.value.indicatorInstances;
  await f.state.handleSubmitSelfEval({}, [{ id: 'goal', actualValue: 'unsaved note' }]);
  assert.equal(f.state.task.value.indicatorInstances, instances);
  assert.equal(f.state.task.value.updatedAt, '2038-01-02');
  assert.equal(f.state.writeBlocked.value, true);
  assert.deepEqual(f.cleared, []);
  assert.equal(f.writes.length, 1, 'the failed self-evaluation is not automatically retried');
});

test('late goal failure after switching tasks cannot query the old lifecycle or block the new editor', async t => {
  const pending = deferred(), f = await taskView(t, { write: () => pending.promise });
  const action = f.state.handleSaveIndicators({ action: 'save', instances: [{}] });
  f.route.params.id = 'B'; await flush();
  pending.reject(failure(409)); await action;
  assert.equal(f.state.task.value.id, 'B');
  assert.equal(f.state.writeBlocked.value, false);
  assert.equal(f.state.writeNotice.value, '');
  assert.equal(f.reads.filter(row => row[0] === 'lifecycle').length, 0);
});

for (const status of [401, 403, 404]) test(`${status} blocks further writes without fetching or disclosing lifecycle content`, async t => {
  const f = await workspace(t, 'Employee', { status });
  await f.state.saveDraft();
  assert.equal(f.state.writeBlocked.value, true);
  assert.equal(f.state.writeEnded.value, false);
  assert.doesNotMatch(f.state.writeNotice.value, /Do not display|虚构终止原因/);
  assert.equal(f.reads.length, 1);
  await f.state.submitReview();
  assert.equal(f.writes.length, 1);
});

for (const boundary of ['period', 'account', 'unmount']) test(`late termination verification after ${boundary} cannot contaminate a new session`, async t => {
  const pending = deferred();
  const f = await workspace(t, 'Employee', { lifecycle: () => pending.promise });
  const action = f.state.saveDraft(); await flush();
  if (boundary === 'period') { f.props.periodId = 'period-B'; await flush(); }
  if (boundary === 'account') { f.auth.user = { id: 'other', sysRole: 'employee' }; await flush(); }
  if (boundary === 'unmount') f.unmount();
  const before = f.state.writeNotice?.value;
  pending.resolve({ lifecycleStatus: 'terminated', terminationReason: 'OLD PRIVATE REASON' }); await action;
  assert.equal(f.state.writeNotice.value, before);
  assert.doesNotMatch(f.state.writeNotice.value, /OLD PRIVATE/);
});

test('all three templates keep a nearby notice and mounted disabled form; compile cleanly', () => {
  for (const file of ['TaskDetailView.vue', 'components/EmployeePeriodReviewWorkspace.vue', 'components/ManagerPeriodReviewWorkspace.vue']) {
    const filename = path.join(root, 'views/task', file), { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
    assert.match(descriptor.template.content, /data-testid="[^"]*write-notice"/);
    assert.match(descriptor.template.content, /<fieldset[\s\S]*?:disabled="writeBlocked"/);
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: file }).errors, []);
  }
});

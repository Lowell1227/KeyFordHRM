const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function load(filename, deps, source = fs.readFileSync(filename, 'utf8')) {
  const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = id => {
    if (id in deps) return deps[id];
    if (id.endsWith('.vue')) return {};
    if (id.startsWith('@/')) return load(path.join(root, `${id.slice(2)}.ts`), deps);
    return original(id);
  };
  loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return loaded.exports;
}
function mount(t, mode, query, overrides = {}) {
  const route = vue.reactive({ query }), guards = [], leaves = [], detailReads = [], listReads = [], pushes = [], refreshers = [];
  const cycles = [{ id: 'new', createdAt: '2037-02-01' }, { id: 'old', createdAt: '2037-01-01' }];
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `task-${i}`, taskId: `task-${i}`, cycleId: 'old',
    employeeId: 'employee', employeeName: `Fictional ${String(i).padStart(2, '0')}`, approverId: 'reviewer',
    approvedAt: null, status: mode === 'approval' ? 'approval' : 'hr_calibration', canCalibrate: true,
    canViewDetail: true, calculatedScore: 100 - i, rawGrade: null, calibratedGrade: null }));
  let currentRows = rows, detail = async id => ({ ...rows.find(row => row.id === id), cycleId: route.query.cycleId });
  let acceptDiscard = false;
  const navigate = async target => {
    const to = { ...route, ...target, query: target.query ?? route.query };
    for (const guard of guards) if (await guard(to, route) === false) return false;
    pushes.push(target); route.query = { ...to.query }; return true;
  };
  const deps = {
    'vue-router': { useRoute: () => route, useRouter: () => ({ push: navigate, replace: navigate }),
      onBeforeRouteUpdate: guard => guards.push(guard), onBeforeRouteLeave: guard => leaves.push(guard) },
    'element-plus': { ElMessage: { error() {}, success() {} }, ElMessageBox: {
      confirm: async () => { if (!acceptDiscard) throw Error('continue editing'); },
    } },
    '@/stores/auth.store': { useAuthStore: () => vue.reactive({ user: { id: 'reviewer', sysRole: 'hr', hrCapabilities: [],
      businessCapabilities: { canOperatePerformanceApproval: true } } }) },
    '@/stores/cycle.store': { useCycleStore: () => ({ setCurrent() {} }) },
    '@/composables/useVisibleRefresh': { useVisibleRefresh: options => refreshers.push(options) },
    '@/api/departments.api': { departmentsApi: { findAll: async () => [] } },
    '@/api/cycles.api': { cyclesApi: { findAll: async ({ group }) => ({ items: group === 'active' ? cycles : [], total: group === 'active' ? 2 : 0 }) } },
    '@/api/approval.api': { approvalApi: { getApprovalList: async cycleId => { listReads.push(cycleId); return currentRows.filter(row => row.cycleId === cycleId); },
      getOverview: async () => ({ gradeDistribution: {} }) } },
    '@/api/tasks.api': { tasksApi: { findOne: id => { detailReads.push(id); return detail(id); } } },
    '@/api/calibration.api': { calibrationApi: { listCycles: async () => cycles,
      getWorkbench: async cycleId => { listReads.push(cycleId); return { items: currentRows.filter(row => row.cycleId === cycleId), gradeDistribution: {}, progress: {}, totalActive: currentRows.length }; },
      getCandidateDetail: (_cycle, id) => { detailReads.push(id); return detail(id); } } },
    ...overrides,
  };
  const filename = path.join(root, mode === 'approval' ? 'views/approval/ApprovalView.vue' : 'views/calibration/CalibrationView.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const component = load(filename, deps, compileScript(descriptor, { id: filename }).content).default;
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  return { state, route, rows, guards, leaves, detailReads, listReads, pushes, refreshers, navigate,
    drawer: () => (mode === 'approval' ? state.detailDrawer : state.drawer).value,
    setRows: rows => { currentRows = rows; }, setDetail: read => { detail = read; }, allowDiscard: () => { acceptDiscard = true; } };
}

for (const mode of ['approval', 'calibration']) {
  test(`${mode}: explicit cycle/task opens the non-first row and containing page`, async t => {
    const view = mount(t, mode, { cycleId: 'old', taskId: 'task-23' }); await flush();
    assert.equal(view.state.selectedCycleId.value, 'old'); assert.deepEqual(view.detailReads, ['task-23']);
    assert.equal(view.drawer().detail.taskId ?? view.drawer().detail.id, 'task-23'); assert.equal(view.state.page.value, 3);
  });

  test(`${mode}: invalid or ambiguous explicit cycle/task never picks the first cycle or task`, async t => {
    for (const query of [{ cycleId: 'missing', taskId: 'task-0' }, { cycleId: ['old', 'new'], taskId: 'task-0' },
      { cycleId: 'old', taskId: ['task-0', 'task-1'] }, { taskId: 'task-0' }]) {
      const view = mount(t, mode, query); await flush();
      assert.deepEqual(view.detailReads, []); assert.deepEqual(view.listReads, []);
      assert.ok(view.state.deepLinkMessage.value); assert.equal(view.drawer().visible, false);
      assert.deepEqual(view.route.query, query);
    }
  });

  test(`${mode}: unavailable task is explicit and offers only its original scoped record`, async t => {
    const view = mount(t, mode, { cycleId: 'old', taskId: 'missing' }); await flush();
    assert.deepEqual(view.detailReads, []); assert.equal(view.drawer().visible, false);
    assert.ok(view.state.deepLinkMessage.value); assert.equal(view.state.deepLinkHistoryPath.value, '/tasks/missing');
  });

  test(`${mode}: same-component query switches invalidate old detail and reveal the new row`, async t => {
    const view = mount(t, mode, { cycleId: 'old' }); await flush();
    const old = deferred(); view.setDetail(id => id === 'task-0' ? old.promise : Promise.resolve({ ...view.rows[23] }));
    await view.navigate({ query: { cycleId: 'old', taskId: 'task-0' } }); await flush();
    assert.equal(view.drawer().loading, true);
    await view.navigate({ query: { cycleId: 'old', taskId: 'task-23' } }); await flush();
    old.resolve({ ...view.rows[0] }); await flush();
    assert.equal(view.drawer().detail.taskId ?? view.drawer().detail.id, 'task-23'); assert.equal(view.state.page.value, 3);
  });

  test(`${mode}: query/leave guards preserve draft opinions, selections, and filters until explicit discard`, async t => {
    const view = mount(t, mode, { cycleId: 'old' }); await flush();
    view.state.rejectDialog.value[mode === 'approval' ? 'comment' : 'reason'] = 'Keep this fictional opinion';
    assert.equal(await view.navigate({ query: { cycleId: 'new' } }), false);
    assert.equal(view.route.query.cycleId, 'old'); assert.equal(view.state.selectedCycleId.value, 'old');
    assert.equal(await view.leaves[0](), false);
    assert.equal(view.state.rejectDialog.value[mode === 'approval' ? 'comment' : 'reason'], 'Keep this fictional opinion');
    view.allowDiscard(); assert.equal(await view.navigate({ query: { cycleId: 'new' } }), true); await flush();
    assert.equal(view.state.selectedCycleId.value, 'new');
    assert.equal(view.state.rejectDialog.value[mode === 'approval' ? 'comment' : 'reason'], '');
  });

  test(`${mode}: selections and unsubmitted filter inputs also guard query navigation`, async t => {
    const view = mount(t, mode, { cycleId: 'old' }); await flush();
    view.state.selectedTaskIds.value = ['task-0'];
    assert.equal(await view.navigate({ query: { cycleId: 'old', taskId: 'task-23' } }), false);
    view.state.selectedTaskIds.value = []; view.state.keywordFilter.value = 'not searched';
    assert.equal(await view.navigate({ query: { cycleId: 'new' } }), false);
    assert.equal(view.state.keywordFilter.value, 'not searched');
  });

  test(`${mode}: refresh never reopens a consumed target or clears an opinion`, async t => {
    const view = mount(t, mode, { cycleId: 'old', taskId: 'task-23' }); await flush();
    view.state.closeDetail(); view.state.rejectDialog.value[mode === 'approval' ? 'comment' : 'reason'] = 'preserved';
    if (mode === 'approval') await view.refreshers[0].refresh(() => true); else await view.state.loadCandidates();
    await flush(); assert.equal(view.drawer().visible, false); assert.deepEqual(view.detailReads, ['task-23']);
    assert.equal(view.state.rejectDialog.value[mode === 'approval' ? 'comment' : 'reason'], 'preserved');
  });

  test(`${mode}: current-stage changes become read-only history rather than actionable stale detail`, async t => {
    const view = mount(t, mode, { cycleId: 'old' }); await flush();
    view.setDetail(async () => ({ ...view.rows[0], status: 'published', approvedAt: '2037-01-31' }));
    await view.navigate({ query: { cycleId: 'old', taskId: 'task-0' } }); await flush();
    assert.equal(view.drawer().detail.status, 'published'); assert.ok(view.state.deepLinkMessage.value);
    assert.equal(mode === 'approval' ? view.state.canOperateTask(view.drawer().detail) : view.state.drawerCanCalibrate.value, false);
  });

  test(`${mode}: denied/mismatched detail never populates another task`, async t => {
    const view = mount(t, mode, { cycleId: 'old' }); await flush();
    view.setDetail(async () => { throw { response: { status: 403, data: { message: 'Current access denied' } } }; });
    await view.navigate({ query: { cycleId: 'old', taskId: 'task-0' } }); await flush();
    assert.equal(view.drawer().detail, null); assert.match(view.drawer().error, /Current access denied/);
    view.setDetail(async () => ({ ...view.rows[1] }));
    await view.navigate({ query: { cycleId: 'old', taskId: 'task-23' } }); await flush();
    assert.equal(view.drawer().detail, null); assert.ok(view.drawer().error);
  });

  test(`${mode}: choosing a different cycle drops only the old task target`, async t => {
    const view = mount(t, mode, { cycleId: 'old', taskId: 'task-0', retained: 'yes' }); await flush();
    await (mode === 'approval' ? view.state.selectApprovalCycle('new') : view.state.selectCalibrationCycle('new')); await flush();
    assert.deepEqual(view.route.query, { cycleId: 'new', retained: 'yes' }); assert.equal(view.drawer().visible, false);
  });

  test(`${mode}: reset cannot discard filter drafts when its cycle navigation is declined`, async t => {
    const view = mount(t, mode, { cycleId: 'old' }); await flush();
    view.state.keywordFilter.value = 'keep this filter';
    await (mode === 'approval' ? view.state.resetApprovalFilters() : view.state.resetCalibrationFilters());
    assert.equal(view.route.query.cycleId, 'old'); assert.equal(view.state.keywordFilter.value, 'keep this filter');
  });

  test(`${mode}: lifecycle-ended detail remains read-only even with an unchanged business stage`, async t => {
    const view = mount(t, mode, { cycleId: 'old' }); await flush();
    view.setDetail(async () => ({ ...view.rows[0], lifecycleStatus: 'terminated' }));
    await view.navigate({ query: { cycleId: 'old', taskId: 'task-0' } }); await flush();
    assert.ok(view.state.deepLinkMessage.value);
    assert.equal(mode === 'approval' ? view.state.canOperateTask(view.drawer().detail) : view.state.drawerCanCalibrate.value, false);
  });

  test(`${mode}: invalidating an in-flight list with an unavailable explicit cycle releases loading`, async t => {
    const pending = deferred();
    const overrides = mode === 'approval'
      ? { '@/api/approval.api': { approvalApi: { getApprovalList: () => pending.promise, getOverview: async () => ({}) } } }
      : { '@/api/calibration.api': { calibrationApi: { listCycles: async () => [{ id: 'old' }], getWorkbench: () => pending.promise } } };
    const view = mount(t, mode, { cycleId: 'old' }, overrides); await flush();
    assert.equal(view.state.loading.value, true);
    await view.navigate({ query: { cycleId: 'unavailable', taskId: 'task-0' } }); await flush();
    assert.equal(view.state.loading.value, false); assert.ok(view.state.deepLinkMessage.value);
    pending.resolve(mode === 'approval' ? [] : { items: [], gradeDistribution: {}, progress: {}, totalActive: 0 });
    await flush(); assert.equal(view.state.loading.value, false); assert.equal(view.drawer().visible, false);
  });
}

test('operations link metadata matches existing confirmation/payroll routes and readiness query contract', () => {
  const routes = fs.readFileSync(path.join(root, 'router/routes.ts'), 'utf8');
  for (const name of ['ConfirmationManageDetail', 'ConfirmationMineDetail', 'PayrollApprovalDetail']) assert.match(routes, new RegExp(`name: '${name}'`));
  const confirmation = fs.readFileSync(path.join(root, 'views/confirmation/ConfirmationManageView.vue'), 'utf8');
  assert.match(confirmation, /(?:hasManagementScope|canReadManagementList)\.value \? confirmationApi\.findAll : confirmationApi\.findAssigned/);
  const batches = fs.readFileSync(path.join(root, 'views/compensation/payroll/PayrollBatchesView.vue'), 'utf8');
  assert.match(batches, /const readinessOpen = computed\(\(\) => route\.query\.readiness/);
  assert.match(batches, /const readinessId = computed\(\(\) => readinessOpen\.value/);
  const backend = fs.readFileSync(path.resolve(root, '../../api/src/workbench/workbench.service.ts'), 'utf8');
  assert.match(backend, /\{ subjectId: subject\.id, month: row\.month, readiness: row\.id \}/);
  assert.doesNotMatch(backend, /readinessId: row\.id/);
});

for (const lifecycleStatus of ['terminated', 'deleted']) {
  test(`calibration: returned lifecycle metadata disables original row actions after drawer closes (${lifecycleStatus})`, async t => {
    const view = mount(t, 'calibration', { cycleId: 'old' }); await flush();
    assert.equal(view.state.canCalibrate(view.state.candidates.value[0]), true);
    view.setDetail(async () => ({ ...view.rows[0], lifecycleStatus, lifecycleVersion: 3 }));
    await view.navigate({ query: { cycleId: 'old', taskId: 'task-0' } }); await flush();
    const row = view.state.candidates.value.find(item => item.taskId === 'task-0');
    assert.equal(row.lifecycleStatus, lifecycleStatus); assert.equal(view.state.canCalibrate(row), false);
    assert.equal(view.state.drawerCanCalibrate.value, false); assert.ok(view.state.deepLinkMessage.value);
    assert.match(row.actionHint, /仅可查看/);
    view.state.closeDetail();
    assert.equal(view.state.canCalibrate(view.state.candidates.value.find(item => item.taskId === 'task-0')), false);
  });
}

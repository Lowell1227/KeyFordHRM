const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
const flush = () => new Promise(resolve => setImmediate(resolve));
const savedIntents = new Map();
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
before(() => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => savedIntents.get(key) ?? null, setItem: (key, value) => savedIntents.set(key, value), removeItem: key => savedIntents.delete(key),
} }));
beforeEach(() => savedIntents.clear());
after(() => { if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor); else delete globalThis.localStorage; });
const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
function load(filename, dependencies) {
  const loaded = new Module(filename, module); loaded.paths = module.paths;
  loaded.require = id => {
    if (id in dependencies) return dependencies[id];
    if (id.endsWith('.vue')) return {};
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
function demand(extra = {}) { return { id: 'demand-A', revision: 3, instanceId: 'instance-A', sourceState: 'approved',
  rawDepartment: 'Fictional department', rawPosition: 'Fictional job', rawHeadcount: '2', deptId: 'dept-A',
  departmentName: 'Fictional department', positionId: 'job-A', positionName: 'Fictional job', approvedHeadcount: 2,
  usable: true, issues: [], approvedAt: '2037-01-01T00:00:00Z', sourceLink: null, lastSyncedAt: '2037-01-02T00:00:00Z', ...extra }; }
function application(extra = {}) { return { id: 'app-A', candidateId: 'candidate-A', positionName: 'Fictional job', deptId: 'dept-A',
  stage: 'interviewing', revision: 6, allowedActions: ['submit_hiring', 'start_interview'], events: [], ...extra }; }
async function panel(t, overrides = {}, props = {}, user = { sysRole: 'employee', hrCapabilities: ['recruitment_edit'] }, options = {}) {
  const calls = [], queries = [], confirmations = [];
  const api = { applications: async () => [application()], detail: async () => application(),
    owners: async () => ({ items: [] }), create: async (_id, body) => { calls.push(body); return application(); },
    action: async (id, body) => { calls.push({ id, ...body }); return application({ stage: 'hiring_review' }); }, ...overrides };
  const dependencies = {
    'vue-router': { useRouter: () => ({ resolve: () => ({}), push() {} }) },
    'element-plus': { ElMessageBox: { confirm: async (...args) => { confirmations.push(args); return options.confirm ? options.confirm(...args) : true; } } },
    '@/stores/auth.store': { useAuthStore: () => ({ user }) },
    '../useRecruitmentLeaveGuard': { useRecruitmentLeaveGuard: () => ({ prepareToLeave: async () => true }) },
    '@/api/departments.api': { departmentsApi: { findAll: async () => [] } },
    '@/router/navigation': { canAccessRoute: () => false },
    '@/api/talent-recruitment.api': { talentRecruitmentApi: api, recruitmentError: error => error.response?.data?.message || error.message },
    '@/api/recruitment-demands.api': { recruitmentDemandsApi: {
      options: async query => { queries.push(query); return { items: [demand()], total: 1 }; }, detail: async () => demand({ revision: 4 }),
      status: async () => ({ configured: true, missing: [], readOnly: true }),
      directories: async () => ({ departments: [{ id: 'dept-A', name: 'Fictional department' }], positions: [{ id: 'job-A', code: 'F01', name: 'Fictional job' }] }),
    } },
  };
  const component = load(path.join(root, 'views/talent/components/TalentApplicationPanel.vue'), dependencies).default;
  let state;
  const app = renderer.createApp({ setup() {
    state = component.setup(vue.reactive({ candidateId: 'candidate-A', editable: true, ...props }), { expose() {}, emit() {} }); return () => null;
  } });
  app.mount({}); t.after(() => app.unmount()); await flush();
  return { state, calls, queries, confirmations };
}

test('submit hiring requires a demand near the action; creation and interview do not', async t => {
  const view = await panel(t);
  await view.state.beginAction('submit_hiring'); view.state.note.value = 'Fictional hiring opinion';
  await view.state.execute();
  assert.equal(view.calls.length, 0);
  assert.match(view.state.demandError.value, /招聘需求/);
  assert.equal(view.queries[0].applicationId, 'app-A');
  await view.state.beginAction('start_interview'); await view.state.execute();
  assert.equal(view.calls[0].action, 'start_interview');
  assert.equal('recruitmentDemandId' in view.calls[0], false);
  const count = view.queries.length;
  await view.state.openEditor(true);
  view.state.form.positionName = 'Any free-text job'; view.state.formRef.value = { validate: async () => true };
  await view.state.save();
  assert.equal(view.calls.at(-1).positionName, 'Any free-text job');
  assert.equal('recruitmentDemandId' in view.calls.at(-1), false);
  assert.equal(view.queries.length, count);
});

test('selected actual demand and revision travel only with submit_hiring', async t => {
  const view = await panel(t);
  await view.state.beginAction('submit_hiring');
  view.state.chooseDemand('demand-A'); view.state.note.value = 'Fictional opinion';
  await view.state.execute();
  assert.deepEqual(view.calls, [{ id: 'app-A', expectedRevision: 6, action: 'submit_hiring', note: 'Fictional opinion',
    recruitmentDemandId: 'demand-A', expectedDemandRevision: 3 }]);
});

test('409 preserves opinion and demand; explicit refresh updates versions without resubmitting', async t => {
  let attempts = 0;
  const view = await panel(t, { detail: async () => application({ revision: 7 }), action: async () => {
    attempts++;
    throw { response: { status: 409, data: { message: '招聘需求来源已变化，请核对' } } };
  } });
  await view.state.beginAction('submit_hiring'); view.state.chooseDemand('demand-A'); view.state.note.value = 'Keep this opinion';
  await view.state.execute();
  assert.equal(view.state.conflict.value, true);
  assert.equal(view.state.note.value, 'Keep this opinion');
  assert.equal(view.state.selectedDemand.value.id, 'demand-A');
  assert.equal(view.state.selectedDemand.value.revision, 3);
  await view.state.refreshHiringContext();
  assert.equal(view.state.note.value, 'Keep this opinion');
  assert.equal(view.state.selectedDemand.value.revision, 4);
  assert.equal(view.state.current.value.revision, 7);
  assert.equal(view.state.command.value, 'submit_hiring');
  assert.equal(attempts, 1);
});

test('a read-only panel cannot begin or invoke submit_hiring and onboarding is not broadened', async t => {
  const view = await panel(t, {}, { editable: false }, { sysRole: 'employee', hrCapabilities: ['recruitment_view'] });
  await view.state.beginAction('submit_hiring');
  assert.equal(view.state.command.value, null); assert.deepEqual(view.queries, []);
  view.state.command.value = 'submit_hiring'; view.state.selectedDemand.value = demand(); view.state.note.value = 'Cannot send';
  await view.state.execute(); assert.deepEqual(view.calls, []);
  view.state.current.value = application({ stage: 'accepted' }); assert.equal(view.state.canOnboard.value, false);
});

test('legacy submitted applications can continue confirmation without a demand snapshot', async t => {
  const view = await panel(t, { applications: async () => [application({ stage: 'hiring_review', allowedActions: ['approve_hiring'], recruitmentDemandSnapshot: null })] });
  await view.state.beginAction('approve_hiring'); await view.state.execute();
  assert.equal(view.calls[0].action, 'approve_hiring');
  assert.equal('recruitmentDemandId' in view.calls[0], false); assert.deepEqual(view.queries, []);
});

test('missing department offers current-application editing without losing the hiring opinion', async t => {
  const view = await panel(t, { applications: async () => [application({ deptId: null })] });
  await view.state.beginAction('submit_hiring'); view.state.note.value = 'Keep while editing department';
  assert.match(view.state.demandApplicationIssue.value, /部门/);
  await view.state.openEditor(false, true);
  assert.equal(view.state.editing.value, true); assert.equal(view.state.form.deptId, '');
  assert.equal(view.state.note.value, 'Keep while editing department');
  assert.equal(view.state.command.value, 'submit_hiring');
});

test('terminate_offer is an explicit server-provided editor action requiring reason and a second confirmation', async t => {
  const view = await panel(t, { applications: async () => [application({ stage: 'accepted', allowedActions: ['terminate_offer'] })] });
  assert.ok(view.state.actions.value.includes('terminate_offer'));
  assert.equal(view.state.actionLabel('terminate_offer'), '终止录用');
  await view.state.beginAction('terminate_offer'); await view.state.execute();
  assert.match(view.state.noteError.value, /终止.*原因/); assert.deepEqual(view.calls, []); assert.deepEqual(view.confirmations, []);
  view.state.note.value = '  Fictional termination reason  '; await view.state.execute();
  assert.deepEqual(view.calls, [{ id: 'app-A', expectedRevision: 6, action: 'terminate_offer', note: 'Fictional termination reason' }]);
  assert.equal(view.confirmations[0][1], '终止录用并释放名额');
  assert.equal(view.confirmations[0][2].confirmButtonText, '终止录用并释放名额');
  assert.deepEqual(view.queries, []); assert.equal(view.state.canOnboard.value, false);
});

test('withdrawn compatibility can terminate when the server allows it; cancelling confirmation preserves the reason', async t => {
  const view = await panel(t, { applications: async () => [application({ stage: 'withdrawn', allowedActions: ['terminate_offer'] })] }, {}, undefined,
    { confirm: async () => { throw new Error('cancel'); } });
  await view.state.beginAction('terminate_offer'); view.state.note.value = 'Keep this reason'; await view.state.execute();
  assert.equal(view.confirmations.length, 1); assert.deepEqual(view.calls, []);
  assert.equal(view.state.note.value, 'Keep this reason'); assert.equal(view.state.command.value, 'terminate_offer');
});

test('active onboarding must use the original authorized withdrawal path first, without releasing seats', async t => {
  const view = await panel(t, { applications: async () => [application({ stage: 'onboarding', allowedActions: ['terminate_offer'],
    onboardingRequest: { id: 'entry-A', recordStatus: 'pending', onboardingStatus: 'submitted', cancelledAt: null } })] });
  await view.state.beginAction('terminate_offer'); view.state.note.value = 'Not a withdrawal permission'; await view.state.execute();
  assert.deepEqual(view.calls, []); assert.deepEqual(view.confirmations, []);
  assert.match(view.state.error.value, /入职.*撤回|撤回.*入职/); assert.match(view.state.error.value, /不释放/);
  assert.equal(view.state.canViewArchive.value, false);
});

test('termination neither invents server eligibility nor grants recruitment viewers an editor action', async t => {
  for (const [row, props, user] of [
    [application({ stage: 'accepted', allowedActions: [] }), {}, undefined],
    [application({ stage: 'hired', allowedActions: [] }), {}, undefined],
    [application({ stage: 'accepted', allowedActions: ['terminate_offer'] }), { editable: false }, { sysRole: 'employee', hrCapabilities: ['recruitment_view'] }],
  ]) {
    const view = await panel(t, { applications: async () => [row] }, props, user);
    assert.equal(view.state.actions.value.includes('terminate_offer'), false);
    await view.state.beginAction('terminate_offer'); assert.equal(view.state.command.value, null);
    view.state.command.value = 'terminate_offer'; view.state.note.value = 'Must not send'; await view.state.execute();
    assert.deepEqual(view.calls, []);
  }
});

test('termination rechecks permission after the confirmation and cannot double-submit', async t => {
  let resolve;
  const decision = new Promise(done => { resolve = done; });
  const user = vue.reactive({ sysRole: 'employee', hrCapabilities: ['recruitment_edit'] });
  const view = await panel(t, { applications: async () => [application({ stage: 'accepted', allowedActions: ['terminate_offer'] })] }, {}, user, { confirm: () => decision });
  await view.state.beginAction('terminate_offer'); view.state.note.value = 'Revoked while confirming';
  const first = view.state.execute(); await flush(); await view.state.execute();
  assert.equal(view.confirmations.length, 1);
  user.hrCapabilities = []; resolve(); await first;
  assert.deepEqual(view.calls, []); assert.equal(view.state.note.value, 'Revoked while confirming');
});

for (const status of [409, 503, 403]) {
  test(`fresh submit ${status} preserves opinion/selection and requires explicit refresh before manual resubmission`, async t => {
    let attempts = 0;
    const view = await panel(t, { action: async () => { attempts++; throw { response: { status, data: { message: 'Fictional source or permission failure' } } }; } });
    await view.state.beginAction('submit_hiring'); view.state.chooseDemand('demand-A'); view.state.note.value = 'Keep the hiring opinion';
    await view.state.execute(); await flush();
    assert.equal(attempts, 1); assert.equal(view.state.hiringNeedsRefresh.value, true);
    assert.equal(view.state.note.value, 'Keep the hiring opinion'); assert.equal(view.state.selectedDemand.value.id, 'demand-A');
    await view.state.execute(); assert.equal(attempts, 1);
    await view.state.refreshHiringContext(); assert.equal(attempts, 1);
    await view.state.execute(); assert.equal(attempts, 2);
  });
}

async function ledger(t, canEdit = true, overrides = {}, auth = vue.reactive({ user: { id: 'actor-A' } })) {
  const calls = [];
  const dependencies = {
    'vue-router': { useRoute: () => ({ query: { candidateId: 'candidate-A', applicationId: 'app-A' } }), useRouter: () => ({ push() {} }) },
    'element-plus': { ElMessageBox: { confirm: async () => true } },
    '@/stores/auth.store': { useAuthStore: () => auth },
    '../talent/useRecruitmentLeaveGuard': { useRecruitmentLeaveGuard: () => ({ prepareToLeave: async () => true }) },
    '../talent/useTalentPermissions': { useTalentPermissions: () => ({ canRead: vue.ref(true), canEdit: vue.ref(canEdit) }) },
    '@/api/talent-recruitment.api': { recruitmentError: error => error.message },
    '@/api/recruitment-demands.api': { recruitmentDemandsApi: {
      list: async () => ({ items: [demand()], total: 1 }), status: async () => ({ configured: false, missing: ['processCode'], readOnly: true }),
      detail: async () => demand(), directories: async () => ({ departments: [{ id: 'dept-A', name: 'Dept' }], positions: [{ id: 'job-A', name: 'Job' }] }),
      mapping: async (id, body) => { calls.push({ id, ...body }); return demand({ revision: 4 }); },
      sync: async body => { calls.push(body); }, refresh: async id => { calls.push({ id }); return demand(); }, ...overrides,
    } },
  };
  const component = load(path.join(root, 'views/recruitment/RecruitmentDemandsView.vue'), dependencies).default;
  let state;
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); await flush(); return { state, calls, auth };
}

test('ledger mapping sends the displayed revision, separate from upstream approval', async t => {
  let reads = 0;
  const view = await ledger(t, true, { detail: async () => demand({ revision: reads++ ? 4 : 3 }) });
  await view.state.openDetail(demand()); await view.state.beginMapping();
  Object.assign(view.state.mapping, { deptId: 'dept-A', positionId: 'job-A', approvedHeadcount: 2, reason: 'Confirmed fictional mapping' });
  await view.state.saveMapping();
  assert.deepEqual(view.calls, [{ id: 'demand-A', expectedRevision: 3, deptId: 'dept-A', positionId: 'job-A',
    approvedHeadcount: 2, reason: 'Confirmed fictional mapping' }]);
  assert.equal(view.state.current.value.sourceState, 'approved');
  assert.equal(view.state.current.value.revision, 4);
});

test('successful mapping reloads authoritative timeline without repeating the write', async t => {
  let reads = 0;
  const view = await ledger(t, true, { detail: async () => demand({ revision: reads++ ? 4 : 3,
    events: reads > 1 ? [{ id: 'event-map', action: 'map', revision: 4, actorName: 'Fictional operator' }] : [] }) });
  await view.state.openDetail(demand()); await view.state.beginMapping();
  Object.assign(view.state.mapping, { deptId: 'dept-A', positionId: 'job-A', approvedHeadcount: 2, reason: 'Fictional source verified' });
  await view.state.saveMapping();
  assert.equal(view.state.current.value.events?.[0]?.action, 'map');
  assert.equal(view.state.current.value.revision, 4);
  assert.equal(reads, 2); assert.equal(view.calls.length, 1);
});

test('a failed timeline read does not misreport a committed mapping or repeat its write', async t => {
  let reads = 0;
  const view = await ledger(t, true, { detail: async () => { if (reads++) throw new Error('Fictional read failure'); return demand(); } });
  await view.state.openDetail(demand()); await view.state.beginMapping();
  Object.assign(view.state.mapping, { deptId: 'dept-A', positionId: 'job-A', approvedHeadcount: 2, reason: 'Fictional source verified' });
  await view.state.saveMapping();
  assert.equal(view.calls.length, 1); assert.equal(view.state.mappingOpen.value, false);
  assert.equal(view.state.current.value.revision, 4);
  assert.match(view.state.resultMessage.value, /已核对/);
  assert.match(view.state.detailError.value, /已保存.*时间线读取失败/);
});

test('ledger viewer cannot invoke mapping, source refresh or sync', async t => {
  const view = await ledger(t, false);
  await view.state.openDetail(demand());
  await view.state.beginMapping(); assert.equal(view.state.mappingOpen.value, false);
  Object.assign(view.state.mapping, { deptId: 'dept-A', positionId: 'job-A', approvedHeadcount: 2, reason: 'No permission' });
  await view.state.saveMapping(); await view.state.refreshSource(); await view.state.syncSource();
  assert.deepEqual(view.calls, []);
  assert.equal(view.state.connection.value.configured, false);
  assert.deepEqual(view.state.connection.value.missing, ['processCode']);
});

test('partial synchronization never claims completion and retains the chosen date range', async t => {
  const view = await ledger(t, true, { status: async () => ({ configured: true, missing: [], readOnly: true }),
    sync: async () => ({ synced: 2, failed: 1, complete: false, remaining: 3, limit: 5, cursor: 'cursor-A' }) });
  view.state.syncOpen.value = true; view.state.syncDates.value = ['2037-01-01', '2037-01-31'];
  await view.state.syncSource();
  assert.equal(view.state.syncOpen.value, true);
  assert.match(view.state.syncError.value, /未完成/);
  assert.match(view.state.syncError.value, /失败 1/);
  assert.deepEqual(view.state.syncDates.value, ['2037-01-01', '2037-01-31']);
});

test('sync range uses China business dates even in an overseas browser timezone', async t => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const bodies = [];
    const view = await ledger(t, true, { status: async () => ({ configured: true, missing: [], readOnly: true }),
      sync: async body => { bodies.push(body); return { complete: true, synced: 0, failed: 0, remaining: 0, limit: 20, cursor: null }; } });
    view.state.syncDates.value = ['2037-01-01', '2037-01-31'];
    await view.state.syncSource();
    assert.equal(bodies[0].from, '2036-12-31T16:00:00.000Z'); assert.equal(bodies[0].to, '2037-01-31T15:59:59.999Z');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

const readySource = { status: async () => ({ configured: true, missing: [], readOnly: true }) };
const completedSync = { synced: 2, failed: 0, remaining: 0, complete: true, cursor: null, limit: 500 };

test('unknown sync response preserves requestId and intent; manual recovery sends the exact same request', async t => {
  const requests = [];
  const view = await ledger(t, true, { ...readySource, sync: async body => {
    requests.push({ ...body }); if (requests.length === 1) throw new Error('timeout'); return completedSync;
  } });
  view.state.syncDates.value = ['2037-01-01', '2037-01-31'];
  await view.state.syncSource(); await flush();
  assert.equal(requests.length, 1); assert.match(requests[0].requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(view.state.syncActionLabel.value, '恢复本次');
  assert.equal(view.state.resultMessage.value, '');
  const saved = JSON.parse(savedIntents.get('recruitment-demand-sync:actor-A'));
  assert.deepEqual(Object.keys(saved).sort(), ['cursor', 'from', 'requestId', 'to']);
  assert.equal(saved.requestId, requests[0].requestId); assert.equal(saved.cursor, null);
  await view.state.syncSource(); assert.deepEqual(requests[1], requests[0]);
  assert.equal(savedIntents.has('recruitment-demand-sync:actor-A'), false);
});

test('explicit continuation sends the cursor and stable dates/id, never reports a partial result as success', async t => {
  const requests = [];
  const view = await ledger(t, true, { ...readySource, sync: async body => {
    requests.push({ ...body }); return requests.length === 1
      ? { ...completedSync, complete: false, remaining: 501, cursor: 'cursor-first' } : completedSync;
  } });
  view.state.syncDates.value = ['2037-01-01', '2037-01-31'];
  await view.state.syncSource(); await flush();
  assert.equal(requests.length, 1); assert.equal(view.state.syncActionLabel.value, '继续同步');
  assert.equal(view.state.resultMessage.value, ''); assert.equal(view.state.syncIntent.value.cursor, 'cursor-first');
  await view.state.syncSource();
  assert.deepEqual(requests[1], { ...requests[0], cursor: 'cursor-first' });
  assert.match(view.state.resultMessage.value, /同步已完成/);
});

test('unknown continuation response retains the existing cursor for an explicit identical retry', async t => {
  const requests = [];
  const view = await ledger(t, true, { ...readySource, sync: async body => {
    requests.push({ ...body });
    if (requests.length === 1) return { ...completedSync, complete: false, remaining: 1, cursor: 'cursor-pending' };
    if (requests.length === 2) throw new Error('timeout after continuation');
    return completedSync;
  } });
  view.state.syncDates.value = ['2037-01-01', '2037-01-31'];
  await view.state.syncSource(); await view.state.syncSource(); await flush();
  assert.equal(requests.length, 2); assert.equal(view.state.syncActionLabel.value, '恢复本次');
  assert.equal(view.state.syncIntent.value.cursor, 'cursor-pending');
  await view.state.syncSource(); assert.deepEqual(requests[2], requests[1]);
});

test('changed dates cannot reuse a pending cursor; explicit new intent gets a new id and no cursor', async t => {
  const requests = [];
  const view = await ledger(t, true, { ...readySource, sync: async body => { requests.push({ ...body }); return { ...completedSync, complete: false, remaining: 1, cursor: 'cursor-old' }; } });
  view.state.syncDates.value = ['2037-01-01', '2037-01-31']; await view.state.syncSource();
  view.state.syncDates.value = ['2037-02-01', '2037-02-28']; await view.state.syncSource();
  assert.equal(requests.length, 1); assert.match(view.state.syncError.value, /另开一批/);
  await view.state.startNewSync();
  view.state.syncDates.value = ['2037-02-01', '2037-02-28']; await view.state.syncSource();
  assert.notEqual(requests[0].requestId, requests[1].requestId);
  assert.equal('cursor' in requests[1], false);
  assert.equal(requests[1].from, '2037-01-31T16:00:00.000Z');
});

test('page reload restores only current-actor metadata without automatically resuming writes', async t => {
  const view = await ledger(t, true, { ...readySource, sync: async () => ({ ...completedSync, complete: false, remaining: 1, cursor: 'cursor-resume' }) });
  view.state.syncDates.value = ['2037-01-01', '2037-01-31']; await view.state.syncSource();
  const restored = await ledger(t, true, readySource);
  assert.deepEqual(restored.state.syncIntent.value, view.state.syncIntent.value);
  assert.deepEqual(restored.state.syncDates.value, ['2037-01-01', '2037-01-31']);
  assert.equal(restored.state.syncActionLabel.value, '恢复本次'); assert.deepEqual(restored.calls, []);
  const other = await ledger(t, true, readySource, vue.reactive({ user: { id: 'actor-B' } }));
  assert.equal(other.state.syncIntent.value, null); assert.deepEqual(other.calls, []);
});

test('an old actor response cannot replace the new actor recovery state or mark it complete', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const view = await ledger(t, true, { ...readySource, sync: () => pending });
  view.state.syncDates.value = ['2037-01-01', '2037-01-31'];
  const request = view.state.syncSource(); await flush();
  view.auth.user = { id: 'actor-B' }; await flush();
  finish(completedSync); await request;
  assert.equal(view.state.syncIntent.value, null); assert.equal(view.state.resultMessage.value, '');
  assert.equal(savedIntents.has('recruitment-demand-sync:actor-B'), false);
  assert.equal(JSON.parse(savedIntents.get('recruitment-demand-sync:actor-A')).cursor, null);
  assert.equal(view.state.saving.value, false);
});

test('mapping 409 retains local mapping and reason until an explicit read, never retries the write', async t => {
  let attempts = 0;
  const view = await ledger(t, true, { mapping: async () => { attempts++; throw { response: { status: 409, data: { message: '版本已变更' } } }; } });
  await view.state.openDetail(demand()); await view.state.beginMapping();
  Object.assign(view.state.mapping, { deptId: 'dept-A', positionId: 'job-A', approvedHeadcount: 2, reason: 'Keep this evidence' });
  await view.state.saveMapping(); await view.state.saveMapping();
  assert.equal(attempts, 1); assert.equal(view.state.mappingConflict.value, true);
  await view.state.reloadDetail();
  assert.equal(view.state.mapping.reason, 'Keep this evidence'); assert.equal(view.state.mapping.approvedHeadcount, 2);
  assert.equal(attempts, 1);
});

test('first detail read failure has an explicit read-only retry', async t => {
  let reads = 0;
  const view = await ledger(t, true, { detail: async () => { if (!reads++) throw new Error('Network'); return demand(); } });
  await view.state.openDetail(demand()); assert.equal(view.state.current.value, null);
  await view.state.reloadDetail(); assert.equal(view.state.current.value?.id, 'demand-A');
  assert.deepEqual(view.calls, []);
});

function renderTemplate(relative, state, props = {}) {
  const filename = path.join(root, relative), { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: filename });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: filename,
    compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const rendered = new Module(filename, module);
  rendered.require = () => ({ ...vue, resolveComponent: name => ({ name }), resolveDirective: () => ({}), withDirectives: node => node });
  rendered._compile(ts.transpileModule(template.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  const setup = vue.proxyRefs(state);
  return rendered.exports.render(setup, [], props, setup, {}, {});
}
function displayText(node) {
  if (Array.isArray(node)) return node.map(displayText).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node?.children?.default) return displayText(node.children.default());
  return node?.children ? displayText(node.children) : '';
}
function nestedNodes(node) {
  if (Array.isArray(node)) return node.flatMap(nestedNodes);
  if (!node || typeof node !== 'object') return [];
  if (node.type?.name === 'el-table-column') return [node];
  const children = node.children?.default ? node.children.default() : node.children;
  return [node, ...(typeof children === 'string' ? [] : nestedNodes(children))];
}

test('mapping controls mount only after directories are ready, preserving local input', async t => {
  let finishDirectories;
  const directories = new Promise(resolve => { finishDirectories = resolve; });
  const view = await ledger(t, true, { directories: () => directories });
  await view.state.openDetail(demand());
  const opening = view.state.beginMapping();
  view.state.mapping.reason = 'Preserve fictional verification';
  let nodes = nestedNodes(renderTemplate('views/recruitment/RecruitmentDemandsView.vue', view.state).children.detail());
  assert.equal(view.state.directoryLoading.value, true);
  assert.equal(nodes.some(node => node.type?.name === 'el-input-number'), false);
  assert.equal(nodes.some(node => node.type?.name === 'el-skeleton'), true);
  finishDirectories({ departments: [{ id: 'dept-A', name: 'Dept' }], positions: [{ id: 'job-A', name: 'Job' }] });
  await opening;
  nodes = nestedNodes(renderTemplate('views/recruitment/RecruitmentDemandsView.vue', view.state).children.detail());
  const form = nodes.find(node => node.type?.name === 'el-form'
    && nestedNodes(node).some(child => child.type?.name === 'el-input-number'));
  assert.ok(form); assert.equal(form.props.disabled, false);
  assert.equal(view.state.mapping.reason, 'Preserve fictional verification');
  assert.equal(view.state.mapping.approvedHeadcount, 2);
});

test('PC and mobile demand lists distinguish missing counts, unverified capacity and real zeros', async t => {
  const view = await ledger(t);
  for (const [approvedHeadcount, remainingCount, expected] of [[0, 0, '0'], [null, null, '待核对'], [undefined, undefined, '—']]) {
    const row = demand({ approvedHeadcount, remainingCount });
    view.state.rows.value = [row];
    const tree = renderTemplate('views/recruitment/RecruitmentDemandsView.vue', view.state);
    const columns = nestedNodes(tree.children['desktop-list']()).filter(node => node.type?.name === 'el-table-column');
    for (const label of ['批准人数', '剩余名额']) {
      const column = columns.find(node => node.props.label === label);
      assert.ok(column, `${label} column must be available`);
      assert.equal(displayText(column.children.default({ row })), expected);
    }
    const mobile = displayText(tree.children['mobile-list']());
    assert.ok(mobile.includes(`批准人数${expected}剩余名额${expected}`));
  }
});

test('demand detail passes the live backend record to the existing read-only seats component', async t => {
  const view = await ledger(t);
  view.state.current.value = demand({ occupiedCount: 3, acceptedCount: 1, hiredCount: 2, remainingCount: 0, overCount: 1 });
  const tree = renderTemplate('views/recruitment/RecruitmentDemandsView.vue', view.state);
  const seats = nestedNodes(tree.children.detail()).find(node => view.state.RecruitmentDemandSeats && node.type === view.state.RecruitmentDemandSeats);
  assert.ok(seats); assert.equal(seats.props.value, view.state.current.value);
  const flow = nestedNodes(tree.children.detail()).find(node => view.state.RecruitmentDemandApplications && node.type === view.state.RecruitmentDemandApplications);
  assert.ok(flow); assert.equal(flow.props['demand-id'], 'demand-A');
});

test('submitted snapshot uses only current demand seat facts, never derives current counts from its frozen headcount', () => {
  const filename = path.join(root, 'views/recruitment/components/RecruitmentDemandSummary.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const state = load(filename, {}).default.setup({}, { expose() {} });
  const snapshot = { demandId: 'demand-A', revision: 1, instanceId: 'instance-A', departmentName: 'Fictional department', positionName: 'Fictional job', approvedHeadcount: 2, sourceLink: null };
  for (const current of [demand({ occupiedCount: 3, acceptedCount: 1, hiredCount: 2, remainingCount: 0, overCount: 1 }), null]) {
    const tree = renderTemplate('views/recruitment/components/RecruitmentDemandSummary.vue', state, { snapshot, current });
    const seats = nestedNodes(tree).find(node => state.RecruitmentDemandSeats && node.type === state.RecruitmentDemandSeats);
    assert.ok(seats); assert.equal(seats.props.value, current);
    assert.equal(snapshot.approvedHeadcount, 2);
    assert.ok(descriptor.template.content.indexOf('需求当前状态') < descriptor.template.content.indexOf('<RecruitmentDemandSeats'));
  }
});

test('demand API preserves list/options filters and optimistic versions with encoded ids', async () => {
  const calls = [];
  const api = load(path.join(root, 'api/recruitment-demands.api.ts'), { './http': { __esModule: true, default: Object.fromEntries(
    ['get', 'post', 'patch'].map(method => [method, async (...args) => { calls.push({ method, args }); return {}; }])) } }).recruitmentDemandsApi;
  await api.list({ keyword: 'fictional', status: 'approved', page: 2, pageSize: 10 });
  await api.options({ applicationId: 'app-A', keyword: 'FIC', page: 3, pageSize: 20 });
  await api.detail('id/a'); await api.refresh('id/a');
  await api.mapping('id/a', { expectedRevision: 3, deptId: 'dept-A', positionId: 'job-A', approvedHeadcount: 2, reason: 'Fictional' });
  assert.deepEqual(calls[0].args[1].params, { keyword: 'fictional', status: 'approved', page: 2, pageSize: 10 });
  assert.deepEqual(calls[1].args[1].params, { applicationId: 'app-A', keyword: 'FIC', page: 3, pageSize: 20 });
  for (const call of calls.slice(2)) assert.ok(call.args[0].includes('id%2Fa'));
  assert.equal(calls[4].args[1].expectedRevision, 3);
  assert.equal(calls[4].args[2].skipErrorMessage, true);
  const body = { from: '2036-12-31T16:00:00.000Z', to: '2037-01-31T15:59:59.999Z', requestId: '11111111-1111-4111-8111-111111111111', cursor: 'opaque-cursor' };
  await api.sync(body);
  assert.deepEqual(calls[5].args[1], body); assert.equal(calls[5].args[2].skipErrorMessage, true);
  await api.status(); await api.directories();
  assert.equal(calls[3].args[2].timeout, 60000, 'only source refresh gets a longer timeout');
  assert.equal(calls[5].args[2].timeout, 60000, 'only sync gets a longer timeout');
  for (const index of [0, 1, 2, 4, 6, 7]) assert.equal(calls[index].args.at(-1).timeout, undefined, `${calls[index].args[0]} retains the HTTP default`);
});

test('terminate_offer uses the existing versioned application action API without a parallel release endpoint', async () => {
  const calls = [];
  const api = load(path.join(root, 'api/talent-recruitment.api.ts'), { './http': { __esModule: true, default: {
    post: async (...args) => { calls.push(args); return application({ stage: 'withdrawn' }); },
  } } }).talentRecruitmentApi;
  const body = { action: 'terminate_offer', expectedRevision: 6, note: 'Fictional termination reason' };
  await api.action('app-A', body);
  assert.deepEqual(calls, [['/talent-recruitment/applications/app-A/actions', body, { skipErrorMessage: true, timeout: 60000 }]]);
});

test('fresh/termination actions alone have 60s timeout; transport loss preserves inputs and requires a state read before manual retry', async t => {
  const requests = [];
  const api = load(path.join(root, 'api/talent-recruitment.api.ts'), { './http': { __esModule: true, default: {
    post: async (...args) => { requests.push(args); return {}; },
  } } }).talentRecruitmentApi;
  for (const action of ['submit_hiring', 'terminate_offer', 'approve_hiring', 'withdraw']) await api.action('app-A', { expectedRevision: 6, action, note: 'Fictional opinion' });
  assert.deepEqual(requests.map(call => call[2].timeout), [60000, 60000, undefined, undefined]);
  for (const action of ['submit_hiring', 'terminate_offer']) {
    let attempts = 0;
    const row = application({ stage: action === 'terminate_offer' ? 'accepted' : 'interviewing', allowedActions: [action] });
    const view = await panel(t, { applications: async () => [row], detail: async () => row,
      action: async () => { attempts++; throw new Error('browser transport timeout'); } });
    await view.state.beginAction(action);
    if (action === 'submit_hiring') view.state.chooseDemand('demand-A');
    view.state.note.value = 'Keep the exact local opinion'; await view.state.execute(); await flush();
    assert.equal(attempts, 1); assert.match(view.state.error.value, /暂不能确认结果，先刷新应聘状态再操作/);
    assert.doesNotMatch(view.state.error.value, /未提交|保存失败/);
    assert.equal(view.state.note.value, 'Keep the exact local opinion');
    if (action === 'submit_hiring') assert.equal(view.state.selectedDemand.value.id, 'demand-A');
    await view.state.execute(); assert.equal(attempts, 1);
    if (action === 'submit_hiring') await view.state.refreshHiringContext(); else await view.state.select(row.id, true);
    assert.equal(attempts, 1); assert.equal(view.state.actionResultUnknown.value, false);
    await view.state.execute(); assert.equal(attempts, 2);
  }
});

test('current offer termination uses the optional server flag, preserves legacy stages and makes no unlinked seat-release claim', async t => {
  const view = await panel(t, { applications: async () => [application({ stage: 'withdrawn', allowedActions: [], offerTerminated: true })] });
  assert.equal(view.state.applicationStageLabel(view.state.current.value), '录用已终止');
  assert.equal(view.state.applicationStageLabel(application({ stage: 'withdrawn', offerTerminated: false })), '已撤回');
  assert.equal(view.state.applicationStageLabel(application({ stage: 'withdrawn' })), '已撤回');
  assert.equal(view.state.applicationStageLabel(application({ stage: 'screening', offerTerminated: false })), '初筛');
  const legacy = await panel(t, { applications: async () => [application({ stage: 'accepted', allowedActions: ['terminate_offer'], recruitmentDemandId: null })],
    action: async () => application({ stage: 'withdrawn', offerTerminated: true, recruitmentDemandId: null, allowedActions: [] }) });
  await legacy.state.beginAction('terminate_offer'); legacy.state.note.value = 'Fictional legacy termination'; await legacy.state.execute();
  assert.match(legacy.state.actionResult.value, /已终止本次录用/);
  assert.doesNotMatch(legacy.state.actionResult.value, /释放.*名额/);
});

test('official source links reject unsafe hosts, credentials, ports and non-HTTPS schemes', () => {
  const { safeDemandSourceLink } = load(path.join(root, 'views/recruitment/demand-presentation.ts'), {});
  for (const bad of ['javascript:alert(1)', 'http://aflow.dingtalk.com/a', 'https://dingtalk.com.evil.invalid/a',
    'https://evil.invalid/?host=dingtalk.com', 'https://user:pass@aflow.dingtalk.com/a', 'https://aflow.dingtalk.com:8443/a']) {
    assert.equal(safeDemandSourceLink(bad), '', bad);
  }
  assert.equal(safeDemandSourceLink('https://aflow.dingtalk.com/a'), 'https://aflow.dingtalk.com/a');
});

test('new demand navigation reuses recruitment reading boundary, not titles or hiring confirmation', () => {
  const { routes } = load(path.join(root, 'router/routes.ts'), {});
  const { canAccessRoute, buildNavigation } = load(path.join(root, 'router/navigation.ts'), {});
  const route = routes.find(item => item.name === 'RecruitmentDemands');
  assert.equal(route?.path, '/recruitment/demands');
  for (const hrCapabilities of [['recruitment_view'], ['recruitment_edit']]) {
    const user = { sysRole: 'employee', hrCapabilities };
    assert.equal(canAccessRoute(route, user), true);
    assert.ok(buildNavigation(routes, user).find(module => module.key === 'recruitment').groups
      .flatMap(group => group.items).some(item => item.name === 'RecruitmentDemands'));
  }
  for (const user of [{ sysRole: 'manager', hrCapabilities: [] }, { sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] },
    { sysRole: 'hr', isAssessorOnly: true }]) assert.equal(canAccessRoute(route, user), false);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');
const vue = require('vue');
const { AxiosError } = require('axios');

const root = path.resolve(__dirname, '..');
function evaluate(filename, source, dependencies = {}) {
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = id => {
    if (id in dependencies) return dependencies[id];
    if (id.startsWith('@/utils/')) {
      const target = path.join(root, 'src', `${id.slice(2)}.ts`);
      return evaluate(target, fs.readFileSync(target, 'utf8'), dependencies);
    }
    if (id.endsWith('.vue') || id.startsWith('@/')) return {};
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(filename), `${id}.ts`);
      return evaluate(target, fs.readFileSync(target, 'utf8'), dependencies);
    }
    return originalRequire(id);
  };
  loaded._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}

// Run the real setup functions with Vue's reactivity/lifecycle, without a browser or HTTP.
const renderer = vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
function mountSetup(t, name, input, api = {}) {
  const filename = path.join(root, 'src/views/admin/components', name);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const source = compileScript(descriptor, { id: name }).content;
  const dialogs = [];
  const component = evaluate(filename, source, {
    '@/api/employee-archives.api': { employeeArchivesApi: api },
    '@/api/positions.api': { positionsApi: { findAll: async () => [] } },
    'element-plus': {
      ElMessage: { success() {}, warning() {} },
      ElMessageBox: { confirm: async (...args) => { dialogs.push(args); throw 'cancel'; } },
    },
  }).default;
  const props = vue.reactive(input);
  const events = [];
  let state;
  const app = renderer.createApp({
    setup() {
      state = component.setup(props, { emit: (...args) => events.push(args), expose() {} });
      return () => null;
    },
  });
  app.mount({});
  t.after(() => app.unmount());
  return { state, props, events, dialogs };
}

function returnedArrival(override = {}) {
  return {
    id: 'request-1', userId: 'employee-1', intakeType: 'new_hire', sourceType: 'manual_employee_create',
    recordStatus: 'submitted', onboardingStatus: 'submitted', requestVersion: 5,
    requiresArrivalConfirmation: true, arrivalConfirmedAt: null, archivedAt: null, cancelledAt: null,
    profileReviewStatus: 'rejected', performanceReviewStatus: 'not_required', canResume: true,
    proposedValue: { employee: { effectiveFrom: '2026-11-13', entryDate: '2026-11-13' } },
    ...override,
  };
}

function cancelledArrival(override = {}) {
  return returnedArrival({
    recordStatus: 'cancelled', onboardingStatus: 'cancelled', cancelledAt: '2026-11-12T01:00:00Z',
    profileReviewStatus: 'approved', canResume: false, talentCandidateId: 'talent-original',
    ...override,
  });
}

for (const sourceType of ['manual_archive_change', 'manual_performance_relation']) test(`${sourceType} direct submission shows submit and effective without inventing an HR review`, t => {
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request: {
    id: 'direct-1', sourceType, recordStatus: 'submitted',
    profileReviewStatus: 'approved', performanceReviewStatus: 'approved', appliedAt: '2026-11-13T01:00:00Z',
    createdAt: '2026-11-13T00:00:00Z', baseValue: {}, proposedValue: {},
    events: [{ id: 'event-1', action: 'apply_employee_archive_change', createdAt: '2026-11-13T01:00:00Z', user: { name: '虚构HR' } }],
  } });
  assert.deepEqual(state.timeline.value.map(item => item.title), ['提交', '变更生效']);
  assert.equal(state.timeline.value.at(-1).actor, '虚构HR');
});

test('historical manual approval keeps the actual review step', t => {
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request: {
    id: 'old-1', sourceType: 'manual_archive_change', recordStatus: 'submitted',
    profileReviewStatus: 'approved', performanceReviewStatus: 'not_required', appliedAt: '2026-11-12T01:00:00Z',
    profileReviewedAt: '2026-11-12T00:59:00Z', profileReviewedBy: { id: 'old-hr', name: '虚构审核人' },
    createdAt: '2026-11-12T00:00:00Z', baseValue: {}, proposedValue: {}, events: [],
  } });
  assert.equal(state.timeline.value.some(item => item.title === '档案审核'), true);
});

function historyRequest(overrides = {}) {
  return {
    id: 'history-1', sourceType: 'manual_employee_create', intakeType: 'new_hire',
    recordStatus: 'submitted', onboardingStatus: 'submitted', requestVersion: 3,
    profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
    createdAt: '2026-11-10T01:00:00Z', baseValue: {},
    proposedValue: { employee: { effectiveFrom: '2026-11-15' } },
    revisionHistory: [
      { version: 1, proposedValue: { employee: { effectiveFrom: '2026-11-12' } } },
      { version: 2, proposedValue: { employee: { effectiveFrom: '2026-11-14' } } },
    ],
    events: [
      { id: 'reject-1', action: 'reject_employee_data_change', createdAt: '2026-11-11T01:00:00Z', newValue: { reason: '第一轮日期需要核对' } },
      { id: 'revise-2', action: 'revise_employee_arrival_date', createdAt: '2026-11-12T01:00:00Z', newValue: { requestVersion: 2 } },
      { id: 'reject-2', action: 'reject_employee_data_change', createdAt: '2026-11-12T02:00:00Z', newValue: { reason: '第二轮日期需要核对' } },
      { id: 'revise-3', action: 'revise_employee_arrival_date', createdAt: '2026-11-13T01:00:00Z', newValue: { requestVersion: 3 } },
    ],
    ...overrides,
  };
}

test('each resubmission uses its own version snapshots and retains both rejection reasons', t => {
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request: historyRequest() });
  const timeline = state.timeline.value;
  for (const [id, before, after] of [['revise-2', '2026-11-12', '2026-11-14'], ['revise-3', '2026-11-14', '2026-11-15']]) {
    const round = timeline.find(item => item.eventId === id);
    assert.ok(round.differences?.length, 'each revision must expose its own field differences');
    assert.deepEqual(round.differences.flatMap(group => group.fields).map(field => [field.key, field.before, field.after]), [
      ['employee.effectiveFrom', before, after],
    ]);
  }
  assert.deepEqual(timeline.filter(item => item.eventAction === 'reject_employee_data_change').map(item => item.note), [
    '第一轮日期需要核对', '第二轮日期需要核对',
  ]);
  assert.equal(timeline.find(item => item.eventId === 'reject-1').actor, '未记录');
});

test('revision differences are unknown when an exact version is missing, never borrowed by timestamp', t => {
  const request = historyRequest();
  request.revisionHistory = [{ version: 1, proposedValue: { employee: { effectiveFrom: '2026-11-12' } }, revisedAt: request.events[1].createdAt }];
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request });
  const round = state.timeline.value.find(item => item.eventId === 'revise-2');
  assert.equal(round.differenceStatus, '未记录');
  assert.deepEqual(round.differences, []);
});

test('arrival, resubmission and activation keep deterministic business order for equal timestamps', t => {
  const time = '2026-11-13T01:00:00Z';
  const events = [
    { id: 'z-submit', action: 'submit_employee_create' },
    { id: 'a-approve', action: 'approve_employee_data_change' },
    { id: 'b-arrive', action: 'confirm_employee_arrival' },
    { id: 'c-active', action: 'activate_employee_onboarding' },
  ].map(event => ({ ...event, createdAt: time }));
  const request = historyRequest({ events: [...events].reverse(), revisionHistory: [], requiresArrivalConfirmation: true,
    profileReviewStatus: 'approved', onboardingStatus: 'effective', arrivalConfirmedAt: time, appliedAt: time });
  const { state, props } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request });
  assert.deepEqual(state.timeline.value.map(item => item.eventId).filter(Boolean), events.map(event => event.id));
  props.request.events = events;
  assert.deepEqual(state.timeline.value.map(item => item.eventId).filter(Boolean), events.map(event => event.id));
});

test('a repeated event is shown once and an arrival event is not projected into a second activation audit', t => {
  const time = '2026-11-13T01:00:00Z';
  const arrival = { id: 'arrival-only', action: 'confirm_employee_arrival', createdAt: time };
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request: historyRequest({
    events: [arrival, arrival], profileReviewStatus: 'approved', onboardingStatus: 'effective',
    arrivalConfirmedAt: time, appliedAt: time, requiresArrivalConfirmation: true,
  }) });
  assert.equal(state.timeline.value.filter(item => item.eventId === arrival.id).length, 1);
  assert.equal(state.timeline.value.find(item => item.eventId === arrival.id).title, '确认到岗');
  assert.equal(state.timeline.value.filter(item => item.key === 'effective')[0]?.actor === '系统', false);
});

test('archive history uses the same event presentation and keeps unlinked direct edits independent', t => {
  const direct = { id: 'direct-old', entityId: 'employee-1', action: 'employee_profile_direct_update',
    createdAt: '2026-11-13T01:00:00Z', user: null, oldValue: { education: '本科' }, newValue: { education: '硕士' } };
  const request = historyRequest();
  const archive = mountSetup(t, 'EmployeeChangeHistory.vue', { requests: [request], events: [direct, direct] });
  assert.equal(archive.state.standaloneEvents?.value.length, 1, 'unlinked direct events must remain independently visible');
  const event = archive.state.standaloneEvents.value[0];
  assert.equal(event.actor, '未记录');
  assert.deepEqual(event.differences.flatMap(group => group.fields).map(field => [field.label, field.before, field.after]), [['学历', '本科', '硕士']]);
  const detail = mountSetup(t, 'EmployeeApplicationDetail.vue', { request });
  const archived = archive.state.requestEvents(request);
  for (const item of archived) {
    const same = detail.state.timeline.value.find(step => step.eventId === item.eventId);
    assert.equal(same.title, item.title);
    assert.equal(same.note, item.note);
    assert.deepEqual(same.differences, item.differences);
  }
});

test('sensitive replacements use explicit safe markers and never expose raw data', t => {
  const request = historyRequest({ intakeType: null, sourceType: 'manual_archive_change',
    baseValue: { profile: { idNumberConfigured: true, bankAccountConfigured: true } },
    proposedValue: { profile: { idNumberConfigured: true, bankAccountConfigured: true, idNumber: 'PRIVATE-ID', bankAccount: 'PRIVATE-BANK' } },
    changedFields: ['profile.idNumber', 'profile.bankAccount', 'profile.unknown'],
  });
  const { state, props } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request });
  assert.deepEqual(state.allChangeItems.value.map(field => [field.label, field.after]), [['身份证', '已更换'], ['银行卡', '已更换']]);
  assert.doesNotMatch(JSON.stringify(state.allChangeItems.value), /PRIVATE/);
  props.request.changedFields = undefined;
  assert.deepEqual(state.allChangeItems.value.map(field => [field.label, field.after]), [['身份证', '变更未记录'], ['银行卡', '变更未记录']]);
});

test('review decisions show their exact historical baseline, not the latest proposal', t => {
  const request = historyRequest();
  request.revisionHistory[0].baseValue = { employee: { effectiveFrom: '2026-11-11' } };
  request.events = ['approve_employee_data_change', 'reject_employee_data_change', 'apply_employee_archive_change'].map((action, index) => ({
    id: `decision-${index}`, action, createdAt: '2026-11-11T01:00:00Z', newValue: { requestVersion: 1, reason: '历史原因' },
  }));
  const { state, props } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request });
  for (const event of state.timeline.value.filter(item => item.eventId)) {
    assert.equal(event.differenceStatus, '已记录');
    assert.deepEqual(event.differences.flatMap(group => group.fields).map(field => [field.before, field.after]), [['2026-11-11', '2026-11-12']]);
  }
  props.request.events[0].newValue = {};
  assert.equal(state.timeline.value.find(item => item.eventId === 'decision-0').differenceStatus, '未记录');
});

test('equal-time rounds sort by explicit version before stage, independent of API event order', t => {
  const events = [
    ['submit_employee_create', 1], ['reject_employee_data_change', 1], ['revise_employee_arrival_date', 2],
    ['reject_employee_data_change', 2], ['revise_employee_arrival_date', 3], ['approve_employee_data_change', 3],
  ].map(([action, requestVersion], index) => ({ id: `round-${index}`, action, createdAt: '2026-11-13T01:00:00Z', newValue: { requestVersion } }));
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request: historyRequest({ events: [...events].reverse() }) });
  assert.deepEqual(state.timeline.value.filter(item => item.eventId).map(item => item.eventId), events.map(item => item.id));
});

test('explicitly unchanged sensitive fields do not claim replacements and foreign snapshots cannot supply a revision', t => {
  const request = historyRequest({ intakeType: null, sourceType: 'manual_archive_change', changedFields: [],
    baseValue: { profile: { idNumberConfigured: true } }, proposedValue: { profile: { idNumberConfigured: true } },
    revisionHistory: [{ version: 1, sourceRequestId: 'another-request', proposedValue: { profile: { education: '本科' } } }],
  });
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request });
  assert.deepEqual(state.allChangeItems.value, []);
  assert.equal(state.timeline.value.find(item => item.eventId === 'revise-2').differenceStatus, '未记录');
});

test('draft events remain separate around formal actions and do not become duplicate resubmissions', t => {
  const events = [
    ['save_employee_create_draft', 'actor-a'], ['save_employee_create_draft', 'actor-a'],
    ['submit_employee_create', 'actor-a'], ['reject_employee_data_change', 'actor-b'],
    ['save_employee_create_draft', 'actor-a'], ['revise_employee_arrival_date', 'actor-a'],
  ].map(([action, actor], index) => ({ id: `draft-${index}`, action,
    createdAt: `2026-11-13T01:00:0${index}Z`, user: { id: actor, name: actor }, newValue: { requestVersion: index + 1 } }));
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request: historyRequest({ events: [...events, events[5]] }) });
  assert.deepEqual(state.timeline.value.filter(item => item.eventId).map(item => item.eventId), events.map(item => item.id));
});

test('a consumed archive draft with only a linked direct update is effective once, not awaiting review', t => {
  const event = { id: 'direct-only', entityId: 'employee-1', action: 'employee_profile_direct_update', createdAt: '2026-11-13T01:00:00Z',
    oldValue: { education: '本科' }, newValue: { education: '硕士', requestId: 'history-1', requestVersion: 3 } };
  const request = historyRequest({ sourceType: 'manual_archive_change', intakeType: null, onboardingStatus: null,
    profileReviewStatus: 'not_required', performanceReviewStatus: 'not_required', archivedAt: event.createdAt,
    appliedAt: null, events: [event], baseValue: { profile: { education: '硕士' } }, proposedValue: { profile: { education: '硕士' } } });
  const lifecycleFile = path.join(root, 'src/utils/employee-lifecycle.ts');
  const lifecycle = evaluate(lifecycleFile, fs.readFileSync(lifecycleFile, 'utf8'));
  assert.equal(lifecycle.applicationProgress(request), '已生效');
  assert.equal(lifecycle.applicationType(request), '档案修改');
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request });
  assert.deepEqual(state.timeline.value.map(item => item.title), ['提交', '变更生效']);
  assert.equal(state.timeline.value.filter(item => item.status === '已生效').length, 1);
  assert.deepEqual(state.timeline.value.at(-1).differences.flatMap(group => group.fields).map(field => field.label), ['学历']);
  const archive = mountSetup(t, 'EmployeeChangeHistory.vue', { requests: [request], events: [event] });
  assert.equal(archive.state.standaloneEvents.value.length, 0);
  assert.equal(archive.state.requestEvents(request).length, 1);
  assert.notEqual(lifecycle.applicationProgress({ ...request, requestVersion: 4 }), '已生效', 'an older direct update cannot complete a newer request');
});

test('mixed submission retains direct-change evidence without reporting a second activation', t => {
  const direct = { id: 'mixed-direct', entityId: 'employee-1', action: 'employee_profile_direct_update', createdAt: '2026-11-13T01:00:00Z',
    oldValue: { education: '本科' }, newValue: { education: '硕士', requestId: 'history-1', requestVersion: 3 } };
  const apply = { id: 'mixed-apply', entityId: 'history-1', action: 'apply_employee_archive_change', createdAt: '2026-11-13T01:00:01Z', newValue: { requestVersion: 3 } };
  const request = historyRequest({ sourceType: 'manual_archive_change', intakeType: null, appliedAt: apply.createdAt,
    profileReviewStatus: 'approved', events: [direct, apply], baseValue: {}, proposedValue: { employee: { workLocation: '虚构新地点' } } });
  const { state } = mountSetup(t, 'EmployeeApplicationDetail.vue', { request });
  assert.equal(state.timeline.value.filter(item => item.status === '已生效').length, 1);
  assert.equal(state.timeline.value[0].title, '提交');
  const linked = state.timeline.value.find(item => item.eventId === direct.id);
  assert.equal(linked.status, '同次提交');
  assert.deepEqual(linked.differences.flatMap(group => group.fields).map(field => [field.before, field.after]), [['本科', '硕士']]);
});

test('cancelled unarrived new hire resubmits its original date and identity without confirming arrival', async t => {
  const revisions = [];
  const confirmations = [];
  const request = cancelledArrival();
  const updated = { ...request, recordStatus: 'submitted', onboardingStatus: 'submitted', cancelledAt: null, profileReviewStatus: 'pending', requestVersion: 6 };
  const { state, events } = mountSetup(t, 'EmployeeArrivalConfirmation.vue', {
    request, canEdit: true, canConfirm: true,
  }, {
    reviseArrivalDate: async (...args) => { revisions.push(args); return updated; },
    confirmArrival: async (...args) => { confirmations.push(args); return request; },
  });
  assert.equal(state.visible.value, true);
  state.editDate();
  assert.equal(state.proposedDate.value, '2026-11-13');
  await state.confirmArrival();
  await state.submitDate();
  assert.deepEqual(confirmations, []);
  assert.deepEqual(revisions, [['request-1', { arrivalDate: '2026-11-13', requestVersion: 5 }]]);
  assert.deepEqual(events.find(event => event[0] === 'confirmed'), ['confirmed', updated]);
});

test('cancelled recovery requires the exact first-hire cancellation shape and edit capability', async t => {
  for (const override of [
    { userId: null }, { intakeType: 'reentry' }, { requiresArrivalConfirmation: false },
    { recordStatus: 'submitted' }, { recordStatus: 'archived' }, { cancelledAt: null },
    { onboardingStatus: 'effective' }, { archivedAt: '2026-11-12' }, { arrivalConfirmedAt: '2026-11-12' },
    { arrivalDate: '2026-11-12' }, { arrivalConfirmedById: 'reviewer-1' },
  ]) {
    const revisions = [];
    const { state } = mountSetup(t, 'EmployeeArrivalConfirmation.vue', {
      request: cancelledArrival(override), canEdit: true, canConfirm: true,
    }, { reviseArrivalDate: async (...args) => { revisions.push(args); return cancelledArrival(); } });
    assert.equal(state.visible.value, false, JSON.stringify(override));
    state.proposedDate.value = '2026-11-14';
    await state.submitDate();
    assert.deepEqual(revisions, []);
  }
  const { state } = mountSetup(t, 'EmployeeArrivalConfirmation.vue', {
    request: cancelledArrival(), canEdit: false, canConfirm: true,
  });
  assert.equal(state.visible.value, false);
});

test('returned pre-created new hire keeps date revision and cannot confirm before approval', async t => {
  const calls = [];
  const confirmations = [];
  const request = returnedArrival();
  const { state, events } = mountSetup(t, 'EmployeeArrivalConfirmation.vue', {
    request, canEdit: true, canConfirm: true,
  }, {
    reviseArrivalDate: async (...args) => { calls.push(args); return { ...request, requestVersion: 6, profileReviewStatus: 'pending' }; },
    confirmArrival: async (...args) => { confirmations.push(args); return request; },
  });
  assert.equal(state.visible.value, true);
  state.editDate();
  state.proposedDate.value = '2026-11-14';
  await state.confirmArrival();
  assert.deepEqual(confirmations, []);
  await state.submitDate();
  assert.deepEqual(calls, [['request-1', { arrivalDate: '2026-11-14', requestVersion: 5 }]]);
  assert.equal(events.find(event => event[0] === 'confirmed')[1].profileReviewStatus, 'pending');
});

test('date revision retains edit capability and excludes closed, uncreated and pending-review requests', async t => {
  for (const override of [
    { userId: null }, { requiresArrivalConfirmation: false }, { recordStatus: 'draft' },
    { recordStatus: 'archived' }, { archivedAt: '2026-11-12' }, { cancelledAt: '2026-11-12' },
    { onboardingStatus: 'cancelled' }, { onboardingStatus: 'effective' },
    { arrivalConfirmedAt: '2026-11-12' }, { profileReviewStatus: 'pending' },
    { intakeType: 'reentry', sourceType: 'manual_reentry', employeeNo: null },
  ]) {
    const revisions = [];
    const { state } = mountSetup(t, 'EmployeeArrivalConfirmation.vue', {
      request: returnedArrival(override), canEdit: true, canConfirm: true,
    }, { reviseArrivalDate: async (...args) => { revisions.push(args); return returnedArrival(); } });
    assert.equal(state.visible.value, false, JSON.stringify(override));
    state.proposedDate.value = '2026-11-14';
    await state.submitDate();
    assert.deepEqual(revisions, [], JSON.stringify(override));
  }
  const revisions = [];
  const { state } = mountSetup(t, 'EmployeeArrivalConfirmation.vue', {
    request: returnedArrival(), canEdit: false, canConfirm: true,
  }, { reviseArrivalDate: async (...args) => { revisions.push(args); return returnedArrival(); } });
  assert.equal(state.visible.value, false);
  state.proposedDate.value = '2026-11-14';
  await state.submitDate();
  assert.deepEqual(revisions, []);
});

// Exercise the actual view handlers with only their surrounding UI/services supplied.
function viewHandlers(context) {
  const filename = path.join(root, 'src/views/admin/UserManageView.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const ast = ts.createSourceFile(filename + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['continueDraft', 'resumeApplication', 'openPendingOnboarding'];
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text));
  const source = `export function bind(context) { const { ${Object.keys(context).join(', ')} } = context; let archiveLoadGeneration = 0; ${functions.map(node => node.getText(ast)).join('\n')} return { ${names.join(', ')} }; }`;
  return evaluate(filename, source).bind(context);
}

test('resume and draft-list entry reopen returned pre-created hires in application details, never create', async () => {
  const opened = [];
  const reentries = [];
  const lifecycleFile = path.join(root, 'src/utils/employee-lifecycle.ts');
  const lifecycle = evaluate(lifecycleFile, fs.readFileSync(lifecycleFile, 'utf8'));
  const context = {
    ...lifecycle,
    canEditArchive: vue.ref(true), applicationSaving: vue.ref(false), applicationDetailVisible: vue.ref(true),
    archiveIssueContext: vue.ref(null), createDraftQueue: vue.ref([]), draftDialog: vue.ref({ items: [] }),
    employeeCreateDraft: vue.ref(null), employeeCreateDrawerVisible: vue.ref(false),
    openApplication: async id => { opened.push(id); },
    openEmployeeReentryById: async id => { reentries.push(id); },
  };
  const handlers = viewHandlers(context);
  await handlers.resumeApplication(returnedArrival());
  await handlers.continueDraft(returnedArrival());
  assert.equal(context.employeeCreateDrawerVisible.value, false);
  assert.deepEqual(opened, ['request-1', 'request-1']);
  await handlers.resumeApplication(returnedArrival({ intakeType: 'reentry', sourceType: 'manual_reentry', employeeNo: null }));
  assert.deepEqual(reentries, ['employee-1']);
  assert.equal(opened.length, 2);
  context.canEditArchive.value = false;
  await handlers.resumeApplication(returnedArrival());
  await handlers.continueDraft(returnedArrival());
  assert.equal(opened.length, 2);
});

function conflict(data, status = 409) {
  return new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, undefined, undefined, {
    status, statusText: 'Conflict', headers: {}, config: {},
    data: { code: status, message: 'Existing application', data, timestamp: 1 },
  });
}
function createDrawer(t, api, extra = {}) {
  const mounted = mountSetup(t, 'EmployeeCreateDrawer.vue', { modelValue: true, departments: [], ...extra }, api);
  mounted.state.form.name = 'Fictional candidate';
  mounted.state.sourceTalentId.value = 'talent-1';
  return mounted;
}

test('talent autosave conflict opens the existing application from the Axios error envelope', async t => {
  const { state, events } = createDrawer(t, {
    saveEmployeeCreateDraft: async () => { throw conflict({ applicationId: 'existing-1' }); },
  });
  await state.persistDraft();
  assert.deepEqual(events, [['update:modelValue', false], ['application', 'existing-1']]);
  assert.equal(state.draftId.value, undefined, 'must not overwrite the existing application with the new form');
});

test('talent submit conflict also opens the existing application', async t => {
  const { state, events } = createDrawer(t, {
    createEmployee: async () => { throw conflict({ applicationId: 'existing-2' }); },
  });
  Object.assign(state.form, { company: 'fuede', deptId: 'dept-1', entryDate: '2026-11-12', effectiveFrom: '2026-11-12' });
  state.form.employee.companyText = 'Fictional company';
  await state.submit();
  assert.deepEqual(events, [['update:modelValue', false], ['application', 'existing-2']]);
});

test('recovering an existing talent application while closing does not ask to discard unsaved data', async t => {
  const { state, events, dialogs } = createDrawer(t, {
    saveEmployeeCreateDraft: async () => { throw conflict({ applicationId: 'existing-3' }); },
  });
  await state.prepareToLeave();
  assert.deepEqual(events, [['update:modelValue', false], ['application', 'existing-3']]);
  assert.deepEqual(dialogs, []);
});

test('ordinary version conflicts and malformed/non-talent errors preserve the current form', async t => {
  for (const [error, draftId, talentId] of [
    [conflict(null), undefined, 'talent-1'],
    [conflict({ applicationId: 'existing-1' }), 'draft-1', 'talent-1'],
    [conflict({ applicationId: 'existing-1' }), undefined, undefined],
    [conflict({ applicationId: 'existing-1' }, 403), undefined, 'talent-1'],
    [conflict({ applicationId: 42 }), undefined, 'talent-1'],
    [conflict({ applicationId: ' ' }), undefined, 'talent-1'],
  ]) {
    const { state, events } = createDrawer(t, { saveEmployeeCreateDraft: async () => { throw error; } });
    state.draftId.value = draftId;
    state.sourceTalentId.value = talentId;
    await state.persistDraft();
    assert.deepEqual(events, []);
    assert.equal(state.form.name, 'Fictional candidate');
    assert.equal(state.saveState.value, 'error');
  }
});

test('late talent conflicts cannot navigate after switching or closing the drawer', async t => {
  for (const action of ['switch', 'close']) {
    let reject;
    const { state, props, events } = createDrawer(t, {
      saveEmployeeCreateDraft: () => new Promise((resolve, rejectPromise) => { reject = rejectPromise; }),
    });
    const saving = state.persistDraft();
    if (action === 'switch') { props.talentCandidateId = 'talent-2'; state.reset(); }
    else props.modelValue = false;
    await vue.nextTick();
    reject(conflict({ applicationId: 'stale-1' }));
    await saving;
    assert.deepEqual(events, []);
  }
});

const pendingIdentity = { id: 'employee-1', status: 'pending_entry', archived: false, nextAction: 'view_onboarding' };

test('matched pending identity opens its recoverable original application and preserves the original talent source', async t => {
  const lookups = [];
  const archived = [];
  const { state, events } = createDrawer(t, {
    saveEmployeeCreateDraft: async () => ({ id: 'temporary-draft', requestVersion: 1 }),
    getCurrentReentry: async id => { lookups.push(id); return archived.length ? cancelledArrival() : null; },
    archiveDrafts: async ids => { archived.push(ids); return { failed: [] }; },
  });
  await state.openCandidate(pendingIdentity);
  assert.deepEqual(lookups, ['employee-1']);
  assert.deepEqual(archived, [['temporary-draft']]);
  assert.deepEqual(events, [['saved'], ['update:modelValue', false], ['application', 'request-1']]);
});

test('discovering and opening cancelled first hire only reopens after explicit review submission', async t => {
  const revisions = [];
  const request = cancelledArrival();
  const api = {
    saveEmployeeCreateDraft: async () => ({ id: 'temporary-draft', requestVersion: 1 }),
    archiveDrafts: async () => ({ failed: [] }),
    getCurrentReentry: async () => request,
    reviseArrivalDate: async (...args) => {
      revisions.push(args);
      return { ...request, recordStatus: 'submitted', onboardingStatus: 'submitted',
        cancelledAt: null, profileReviewStatus: 'pending', requestVersion: 6 };
    },
  };
  const drawer = createDrawer(t, api);
  await drawer.state.openCandidate(pendingIdentity);
  assert.deepEqual(revisions, []);
  assert.deepEqual(drawer.events.at(-1), ['application', 'request-1']);
  const panel = mountSetup(t, 'EmployeeArrivalConfirmation.vue', {
    request, canEdit: true, canConfirm: true,
  }, api);
  await vue.nextTick();
  assert.deepEqual(revisions, []);
  panel.state.editDate();
  await vue.nextTick();
  assert.deepEqual(revisions, []);
  assert.equal(request.onboardingStatus, 'cancelled');
  await panel.state.submitDate();
  assert.deepEqual(revisions, [['request-1', { arrivalDate: '2026-11-13', requestVersion: 5 }]]);
});

test('matched pending identity keeps finding reopened submitted and pending-entry first hires', async t => {
  for (const onboardingStatus of ['submitted', 'pending_entry']) {
    const { state, events } = createDrawer(t, {
      saveEmployeeCreateDraft: async () => ({ id: 'temporary-draft', requestVersion: 1 }),
      archiveDrafts: async () => ({ failed: [] }),
      getCurrentReentry: async () => returnedArrival({
        onboardingStatus,
        profileReviewStatus: onboardingStatus === 'submitted' ? 'pending' : 'approved',
      }),
    });
    await state.openCandidate(pendingIdentity);
    assert.deepEqual(events, [['saved'], ['update:modelValue', false], ['application', 'request-1']]);
  }
});

test('reopening preserves backend performance review status without adding it to the date command', async t => {
  for (const performanceReviewStatus of ['not_required', 'pending', 'approved', 'rejected', 'cancelled']) {
    const calls = [];
    const request = cancelledArrival({ performanceReviewStatus });
    const { state, events } = mountSetup(t, 'EmployeeArrivalConfirmation.vue', {
      request, canEdit: true, canConfirm: true,
    }, {
      reviseArrivalDate: async (...args) => {
        calls.push(args);
        return { ...request, recordStatus: 'submitted', onboardingStatus: 'submitted', cancelledAt: null,
          profileReviewStatus: 'pending', requestVersion: 6 };
      },
    });
    state.editDate();
    await state.submitDate();
    assert.deepEqual(calls, [['request-1', { arrivalDate: '2026-11-13', requestVersion: 5 }]]);
    const result = events.find(event => event[0] === 'confirmed')[1];
    assert.equal(result.profileReviewStatus, 'pending');
    assert.equal(result.performanceReviewStatus, performanceReviewStatus);
  }
});

test('pending identity with no recoverable application stays in the form with a local error', async t => {
  for (const result of [null, cancelledArrival({ userId: 'other-employee' }), cancelledArrival({ intakeType: 'reentry' })]) {
    const archived = [];
    const restored = [];
    const { state, events } = createDrawer(t, {
      saveEmployeeCreateDraft: async () => ({ id: 'temporary-draft', requestVersion: 1 }),
      getCurrentReentry: async () => result,
      archiveDrafts: async ids => { archived.push(ids); return { failed: [] }; },
      restoreDrafts: async ids => { restored.push(ids); return { failed: [] }; },
    });
    await state.openCandidate(pendingIdentity);
    assert.deepEqual(events, [['saved']]);
    assert.deepEqual(archived, [['temporary-draft']]);
    assert.deepEqual(restored, [['temporary-draft']]);
    assert.notEqual(state.saveError.value, '');
  }
});

test('late pending-identity lookup cannot navigate after the create drawer closes', async t => {
  let resolveLookup;
  const restored = [];
  const { state, props, events } = createDrawer(t, {
    saveEmployeeCreateDraft: async () => ({ id: 'temporary-draft', requestVersion: 1 }),
    getCurrentReentry: () => new Promise(resolve => { resolveLookup = resolve; }),
    archiveDrafts: async () => ({ failed: [] }),
    restoreDrafts: async ids => { restored.push(ids); return { failed: [] }; },
  });
  const opening = state.openCandidate(pendingIdentity);
  // Flush the save and prepare-to-leave promises to reach the lookup boundary.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(typeof resolveLookup, 'function');
  props.modelValue = false;
  await vue.nextTick();
  resolveLookup(cancelledArrival());
  await opening;
  assert.deepEqual(events, [['saved']]);
  assert.deepEqual(restored, [['temporary-draft']]);
});

test('failed pending-identity recovery lookup restores the transient talent draft', async t => {
  const restored = [];
  const { state, events } = createDrawer(t, {
    saveEmployeeCreateDraft: async () => ({ id: 'temporary-draft', requestVersion: 1 }),
    archiveDrafts: async () => ({ failed: [] }),
    getCurrentReentry: async () => { throw new Error('unavailable'); },
    restoreDrafts: async ids => { restored.push(ids); return { failed: [] }; },
  });
  await state.openCandidate(pendingIdentity);
  assert.deepEqual(restored, [['temporary-draft']]);
  assert.deepEqual(events, [['saved']]);
  assert.notEqual(state.saveError.value, '');
});

test('pending employee list action resolves cancelled first hire through the recovery endpoint', async () => {
  const opened = [];
  const lookups = [];
  const handlers = viewHandlers({
    currentApplications: () => [],
    employeeArchivesApi: {
      getCurrentReentry: async id => { lookups.push(id); return cancelledArrival(); },
      getArchive: async () => ({ changeHistory: [] }),
    },
    openApplication: async id => { opened.push(id); },
    ElMessage: { info() {} },
  });
  await handlers.openPendingOnboarding({ id: 'employee-1', status: 'pending_entry' });
  assert.deepEqual(lookups, ['employee-1']);
  assert.deepEqual(opened, ['request-1']);
});

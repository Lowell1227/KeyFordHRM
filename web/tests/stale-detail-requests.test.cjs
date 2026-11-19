const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { createPinia } = require('pinia');
const { parse, compileScript } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '../src');
function load(filename, dependencies, source = fs.readFileSync(filename, 'utf8')) {
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = id => {
    if (id in dependencies) return dependencies[id];
    if (id.endsWith('.vue')) return {};
    if (id.startsWith('@/')) return load(path.join(root, `${id.slice(2)}.ts`), dependencies);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`), dependencies);
    return originalRequire(id);
  };
  loaded._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}
const renderer = vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
function mount(t, relative, input, dependencies) {
  const filename = path.join(root, relative);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const component = load(filename, dependencies, compileScript(descriptor, { id: relative }).content).default;
  const props = vue.reactive(input), events = [];
  let state;
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { emit: (...args) => events.push(args), expose() {} });
    return () => null;
  } });
  app.mount({});
  t.after(() => app.unmount());
  return { state, props, events, unmount: () => app.unmount() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const messages = { ElMessage: { success() {}, warning() {}, error() {} }, ElMessageBox: { confirm: async () => {} } };
const candidate = id => ({ id, name: `Candidate ${id}`, phone: '', gender: 'unknown', sourceChannel: 'referral',
  tags: [], status: 'new', files: [{ id: `file-${id}`, originalName: `${id}.pdf` }] });
function talent(t, api = {}) {
  const writes = [];
  const mounted = mount(t, 'views/talent/components/TalentFormDrawer.vue', { modelValue: false, candidateId: 'A' }, {
    'element-plus': messages,
    '@/stores/auth.store': { useAuthStore: () => ({ user: { sysRole: 'hr' } }) },
    '@/api/upload.api': { uploadApi: {} },
    '@/api/talent-resume.api': { talentResumeApi: {
      status: async () => ({ enabled: false, configured: false }), current: async () => null,
    } },
    '@/api/talent-recruitment.api': { talentRecruitmentApi: { owners: async () => ({ items: [] }) } },
    '@/api/talent-pool.api': { talentPoolApi: {
      detail: async id => candidate(id), checkPhone: async () => ({ exists: false }),
      update: async (id, body) => { writes.push({ id, body }); },
      create: async body => { writes.push({ id: 'created', body }); return { id: 'created' }; }, ...api,
    } },
  });
  mounted.state.formRef.value = { validate: async () => true, clearValidate() {} };
  return { ...mounted, writes };
}
async function open(editor, id = 'A') {
  editor.props.candidateId = id;
  editor.props.modelValue = true;
  await flush();
}

test('#8 switching to pending B immediately clears A fields and prevents saving', async t => {
  const pending = deferred();
  const editor = talent(t, { detail: id => id === 'B' ? pending.promise : Promise.resolve(candidate(id)) });
  await open(editor);
  assert.equal(editor.state.form.name, 'Candidate A');
  editor.props.candidateId = 'B';
  await flush();
  assert.equal(editor.state.form.name, '');
  assert.deepEqual(editor.state.editFiles.value, []);
  await editor.state.submit();
  assert.deepEqual(editor.writes, []);
  pending.resolve(candidate('B'));
  await flush();
  await editor.state.submit();
  assert.equal(editor.writes[0].id, 'B');
  assert.equal(editor.writes[0].body.name, 'Candidate B');
});

test('#8 failed B load stays empty, blocks save and can retry B', async t => {
  let fail = true;
  const editor = talent(t, { detail: async id => {
    if (id === 'B' && fail) throw new Error('offline');
    return candidate(id);
  } });
  await open(editor);
  editor.props.candidateId = 'B';
  await flush();
  assert.equal(editor.state.form.name, '');
  assert.ok(editor.state.loadError?.value);
  assert.equal(editor.state.loading.value, false);
  await editor.state.submit();
  assert.deepEqual(editor.writes, []);
  fail = false;
  await editor.state.onOpen();
  assert.equal(editor.state.loadError.value, '');
  await editor.state.submit();
  assert.equal(editor.writes[0].body.name, 'Candidate B');
});

test('#8 old same-ID success cannot overwrite a reopened edit session', async t => {
  const old = deferred(); let calls = 0;
  const editor = talent(t, { detail: () => ++calls === 1 ? old.promise : Promise.resolve({ ...candidate('A'), name: 'Fresh A' }) });
  await open(editor);
  editor.props.modelValue = false;
  await flush();
  await open(editor);
  old.resolve(candidate('A'));
  await flush();
  assert.equal(editor.state.form.name, 'Fresh A');
});

test('#8 close invalidates pending detail even without reopening', async t => {
  const pending = deferred();
  const editor = talent(t, { detail: () => pending.promise });
  await open(editor);
  editor.props.modelValue = false;
  await flush();
  pending.resolve(candidate('A'));
  await flush();
  assert.equal(editor.state.form.name, '');
  assert.deepEqual(editor.state.editFiles.value, []);
  await editor.state.submit();
  assert.deepEqual(editor.writes, []);
});

test('#8 old failure cannot clear B loading or surface an error in B', async t => {
  const a = deferred(), b = deferred(); let calls = 0;
  const editor = talent(t, { detail: id => ++calls === 1 ? Promise.resolve(candidate(id)) : id === 'A' ? a.promise : b.promise });
  await open(editor);
  const obsolete = editor.state.onOpen();
  editor.props.candidateId = 'B';
  await flush();
  a.reject(new Error('obsolete'));
  await obsolete.catch(() => {});
  assert.equal(editor.state.loading.value, true);
  assert.equal(editor.state.loadError?.value ?? '', '');
  b.resolve(candidate('B'));
  await flush();
});

test('#8 validation begun for A must not submit after switching to B', async t => {
  const editor = talent(t);
  await open(editor);
  const validation = deferred();
  editor.state.formRef.value.validate = () => validation.promise;
  const submit = editor.state.submit();
  editor.props.candidateId = 'B';
  await flush();
  validation.resolve(true);
  await submit;
  assert.deepEqual(editor.writes, []);
});

test('#8 mismatched detail ID never enables editing or saves foreign fields', async t => {
  const editor = talent(t, { detail: async () => candidate('B') });
  await open(editor);
  await editor.state.submit();
  assert.deepEqual(editor.writes, []);
  assert.equal(editor.state.form.name, '');
  assert.ok(editor.state.loadError?.value);
});

test('#8 late attachment removal does not alter B attachments or busy state', async t => {
  const pending = deferred(); let calls = 0;
  const editor = talent(t, { unbindFile: async (id, fileId) => {
    assert.equal(id, 'A'); assert.equal(fileId, 'file-A'); calls++; return pending.promise;
  } });
  await open(editor);
  const removal = editor.state.removeSavedFile(editor.state.editFiles.value[0]);
  await flush();
  assert.equal(calls, 1);
  editor.props.candidateId = 'B';
  await flush();
  pending.resolve();
  await removal;
  assert.deepEqual(editor.state.editFiles.value.map(file => file.id), ['file-B']);
  assert.equal(editor.state.removingFileId.value, '');
  assert.equal(editor.state.fileError.value, '');
});

function detail(id, extra = {}) {
  return { id, cycleId: `cycle-${id}`, employeeId: 'employee', managerId: 'manager', status: 'approval',
    approvedAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', indicatorInstances: [],
    flowRecords: [], periods: [], ...extra };
}
function store(api) {
  return load(path.join(root, 'stores/task.store.ts'), { '@/api/tasks.api': { tasksApi: api } }).useTaskStore(createPinia());
}
for (const outcome of ['resolve', 'reject']) {
  test(`#14 late A ${outcome} cannot replace B detail/error/loading`, async () => {
    const a = deferred(), b = deferred();
    const taskStore = store({ findOne: id => id === 'A' ? a.promise : b.promise });
    const first = taskStore.fetchDetail('A'), second = taskStore.fetchDetail('B');
    b.resolve(detail('B')); await second;
    a[outcome](outcome === 'resolve' ? detail('A') : new Error('old failure')); await first;
    assert.equal(taskStore.detail.id, 'B');
    assert.equal(taskStore.error, null);
    assert.equal(taskStore.loading, false);
  });
  test(`#14 clear invalidates a pending ${outcome}`, async () => {
    const pending = deferred();
    const taskStore = store({ findOne: () => pending.promise });
    const request = taskStore.fetchDetail('A');
    taskStore.clear();
    pending[outcome](outcome === 'resolve' ? detail('A') : new Error('old failure'));
    await request;
    assert.equal(taskStore.detail, null);
    assert.equal(taskStore.error, null);
    assert.equal(taskStore.loading, false);
  });
}
test('#14 old finally does not end the latest spinner, and switching clears old detail', async () => {
  const a = deferred(), b = deferred();
  const taskStore = store({ findOne: id => id === 'A' ? a.promise : b.promise });
  taskStore.setDetail(detail('previous'));
  const first = taskStore.fetchDetail('A'), second = taskStore.fetchDetail('B');
  assert.equal(taskStore.detail, null);
  a.resolve(detail('A')); await first;
  assert.equal(taskStore.loading, true);
  assert.equal(taskStore.detail, null);
  b.reject(new Error('latest failure')); await second;
  assert.equal(taskStore.error, 'latest failure');
  assert.equal(taskStore.loading, false);
});
test('#14 same-ID retries still commit only the latest request', async () => {
  const old = deferred(); let calls = 0;
  const taskStore = store({ findOne: () => ++calls === 1 ? old.promise : Promise.resolve(detail('A', { employeeName: 'Fresh' })) });
  const first = taskStore.fetchDetail('A');
  await taskStore.fetchDetail('A');
  old.resolve(detail('A', { employeeName: 'Old' })); await first;
  assert.equal(taskStore.detail.employeeName, 'Fresh');
});

function taskView(t, options = {}) {
  const writes = [], cycleRequests = [];
  const api = { findOne: async id => detail(id), ...options.api };
  for (const method of ['confirmIndicators', 'rejectIndicators', 'setIndicators', 'withdrawIndicators',
    'submitSelfEval', 'updateActualValues', 'confirmResult', 'disagreeResult', 'remindCurrentHandler']) {
    api[method] ??= async (...args) => { writes.push([method, ...args]); return detail(args[0]); };
  }
  const taskStore = store(api);
  const route = vue.reactive({ name: 'TaskDetail', params: { id: 'A' }, query: {} });
  const mounted = mount(t, 'views/task/TaskDetailView.vue', {}, {
    'element-plus': options.messages ?? messages,
    'vue-router': { useRoute: () => route, useRouter: () => ({ push() {} }) },
    '@/stores/task.store': { useTaskStore: () => taskStore },
    '@/stores/auth.store': { useAuthStore: () => ({ user: { id: 'employee', sysRole: 'employee' } }) },
    '@/api/tasks.api': { tasksApi: api },
    '@/api/upload.api': { uploadApi: {} },
    '@/api/cycles.api': { cyclesApi: { findOne: id => {
      cycleRequests.push(id);
      return options.cycle ? options.cycle(id) : Promise.resolve({ id, name: id });
    } } },
  });
  return { ...mounted, route, taskStore, writes, cycleRequests };
}

test('#14 route/detail mismatch blocks every detail action before the watcher runs', async t => {
  const pending = deferred();
  const view = taskView(t, { api: { findOne: id => id === 'B' ? pending.promise : Promise.resolve(detail(id)) } });
  await flush();
  view.route.params.id = 'B';
  assert.equal(view.state.task.value, null);
  await view.state.handleConfirmIndicators();
  await view.state.handleRejectIndicators('reason');
  await view.state.handleSaveIndicators({ instances: [{}] });
  await view.state.handleWithdrawIndicators();
  await view.state.handleSubmitSelfEval({}, []);
  await view.state.handleConfirmResult();
  await view.state.handleRemind();
  assert.deepEqual(view.writes, []);
});

for (const outcome of ['resolve', 'reject']) test(`#14 late cycle A ${outcome} cannot overwrite cycle B`, async t => {
  const a = deferred();
  const view = taskView(t, { cycle: id => id === 'cycle-A' ? a.promise : Promise.resolve({ id, name: 'B' }) });
  await flush();
  view.route.params.id = 'B';
  await flush();
  assert.equal(view.state.cycle.value.id, 'cycle-B');
  a[outcome](outcome === 'resolve' ? { id: 'cycle-A', name: 'A' } : new Error('old cycle'));
  await flush();
  assert.equal(view.state.cycle.value.id, 'cycle-B');
  assert.equal(view.state.cycleLoading.value, false);
});

test('#14 cycle is cleared while B detail loads and old finally cannot end B cycle loading', async t => {
  const b = deferred(), oldCycle = deferred(), newCycle = deferred();
  const view = taskView(t, { api: { findOne: id => id === 'B' ? b.promise : Promise.resolve(detail(id)) },
    cycle: id => id === 'cycle-A' ? oldCycle.promise : newCycle.promise });
  await flush();
  view.route.params.id = 'B';
  await flush();
  assert.equal(view.state.cycle.value, null);
  b.resolve(detail('B')); await flush();
  oldCycle.resolve({ id: 'cycle-A' }); await flush();
  assert.equal(view.state.cycle.value, null);
  assert.equal(view.state.cycleLoading.value, true);
  newCycle.resolve({ id: 'cycle-B' }); await flush();
});

test('#14 withdrawal confirmation opened for A cannot write after route changes', async t => {
  const confirmation = deferred();
  const view = taskView(t, { messages: { ...messages, ElMessageBox: { confirm: () => confirmation.promise } } });
  await flush();
  const action = view.state.handleWithdrawIndicators();
  view.route.params.id = 'B'; await flush();
  confirmation.resolve(); await action;
  assert.deepEqual(view.writes, []);
});

test('#14 leaving the detail invalidates pending detail and cycle loads', async t => {
  const pending = deferred();
  const view = taskView(t, { api: { findOne: () => pending.promise } });
  view.unmount();
  pending.resolve(detail('A')); await flush();
  assert.equal(view.taskStore.detail, null);
  assert.deepEqual(view.cycleRequests, []);
});

test('#14 replacing the same task object does not strand the cycle spinner', async t => {
  const pending = deferred();
  const view = taskView(t, { cycle: () => pending.promise });
  await flush();
  assert.equal(view.state.cycleLoading.value, true);
  view.taskStore.setDetail(detail('A', { updatedAt: '2026-11-02T00:00:00Z' }));
  pending.resolve({ id: 'cycle-A', name: 'Obsolete cycle' });
  await flush();
  assert.equal(view.state.cycleLoading.value, false);
  assert.equal(view.state.cycle.value, null);
});

for (const outcome of ['resolve', 'reject']) {
  for (const boundary of ['switch', 'reopen', 'unmount']) {
    test(`#14 late self-evaluation ${outcome} after ${boundary} cannot clear another draft or show feedback`, async t => {
      const pending = deferred(), cleared = [], feedback = [];
      const view = taskView(t, {
        api: { submitSelfEval: () => pending.promise },
        messages: { ...messages, ElMessage: { success: text => feedback.push(text), error: text => feedback.push(text) } },
      });
      await flush();
      view.state.indicatorSnapshotRef.value = { clearSelfEvalDraft: () => cleared.push('A') };
      const action = view.state.handleSubmitSelfEval({}, []);
      if (boundary === 'switch') {
        view.route.params.id = 'B';
        await flush();
      } else if (boundary === 'reopen') {
        await view.state.loadDetail();
      } else {
        view.unmount();
      }
      view.state.indicatorSnapshotRef.value = { clearSelfEvalDraft: () => cleared.push('new-form') };
      const requestsBefore = view.cycleRequests.length;
      view.state.actionLoading.value = true;
      pending[outcome](outcome === 'resolve' ? {} : new Error('obsolete submission'));
      await action;
      assert.deepEqual(cleared, []);
      assert.deepEqual(feedback, []);
      assert.equal(view.cycleRequests.length, requestsBefore);
      assert.equal(view.state.actionLoading.value, true);
    });
  }
}

test('#14 changing task between actual-value save and submit prevents the second write', async t => {
  const pending = deferred(), submitted = [];
  const view = taskView(t, { api: {
    updateActualValues: () => pending.promise,
    submitSelfEval: async id => submitted.push(id),
  } });
  await flush();
  const action = view.state.handleSubmitSelfEval({}, [{ id: 'indicator-A', actualValue: 'done' }]);
  view.route.params.id = 'B'; await flush();
  assert.equal(view.state.actionLoading.value, false);
  pending.resolve({}); await action;
  assert.deepEqual(submitted, []);
});

test('#14 current self-evaluation clears only its own draft and reloads normally', async t => {
  const cleared = [], view = taskView(t);
  await flush();
  view.state.indicatorSnapshotRef.value = { clearSelfEvalDraft: () => cleared.push('A') };
  const before = view.cycleRequests.length;
  await view.state.handleSubmitSelfEval({}, []);
  assert.deepEqual(cleared, ['A']);
  assert.deepEqual(view.writes.map(write => write[0]), ['submitSelfEval']);
  assert.equal(view.cycleRequests.length, before + 1);
  assert.equal(view.state.actionLoading.value, false);
});

test('#14 busy self-evaluation cannot issue a duplicate submit', async t => {
  const view = taskView(t);
  await flush();
  view.state.actionLoading.value = true;
  await view.state.handleSubmitSelfEval({}, []);
  assert.deepEqual(view.writes, []);
});

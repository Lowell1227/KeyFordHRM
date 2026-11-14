const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '../src');
const directory = [
  { id: 'position-a', name: 'Current title A', jobFamily: 'Current family A', isActive: true },
  { id: 'position-b', name: 'Current title B', jobFamily: null, isActive: true },
];

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

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

async function settle() {
  await vue.nextTick();
  await new Promise(resolve => setImmediate(resolve));
}

// Exercise real component setup and Vue scheduling; only HTTP and UI rendering are replaced.
async function mount(t, name, input, api = {}, positions = async () => directory) {
  const filename = path.join(root, 'views/admin/components', name);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const events = [], messages = [], calls = [];
  const component = load(filename, {
    '@/api/upload.api': { uploadApi: {} },
    '@/api/positions.api': { positionsApi: { findAll: positions } },
    '@/api/employee-archives.api': { employeeArchivesApi: {
      createEmployee: async body => { calls.push(body); return { id: 'new-hire-request' }; },
      saveEmployeeCreateDraft: async () => ({ id: 'saved-draft', requestVersion: 2 }),
      ...api,
    } },
    'element-plus': {
      ElMessage: Object.fromEntries(['success', 'warning', 'error', 'info'].map(kind => [kind, value => messages.push([kind, value])])),
      ElMessageBox: { confirm: async () => {} },
    },
  }, compileScript(descriptor, { id: name }).content).default;
  const props = vue.reactive({ modelValue: false, departments: [], ...input });
  let state;
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { emit: (...args) => events.push(args), expose() {} });
    return () => null;
  } });
  app.mount({});
  let mounted = true;
  const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
  t.after(unmount);
  await settle();
  props.modelValue = true;
  await settle();
  return { state, props, events, messages, calls, unmount };
}

function draft(overrides = {}) {
  return {
    id: 'draft-a', sourceType: 'manual_employee_create', intakeType: 'new_hire',
    userId: null, recordStatus: 'draft', profileReviewStatus: 'pending', requestVersion: 1,
    baseValue: {}, proposedValue: {
      employee: {
        name: 'Fictional new hire', company: 'fuede', companyText: 'Fictional company',
        deptId: 'fixture-dept', positionId: 'position-a', position: 'Stored old title', jobFamily: 'Stored old family',
        entryDate: '2026-11-14', effectiveFrom: '2026-11-14', employmentType: 'full_time', employeeStatus: 'probation',
      }, profile: {}, contracts: [], performance: {},
    }, ...overrides,
  };
}

function archive(id = 'employee-a') {
  const currentEmployment = {
    company: 'fuede', deptId: 'fixture-dept', positionId: 'position-a', position: 'Historical title',
    jobFamily: 'Historical family', effectiveFrom: '2020-01-01', employeeStatus: 'active',
  };
  return { id, name: `Fictional ${id}`, status: 'active', dept: { id: 'fixture-dept' },
    currentEmployment, employmentHistory: [currentEmployment], employeeContracts: [] };
}

function review(id = 'request-a') {
  return { id, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
    proposedValue: { employee: { leaveDate: '2026-11-14' } } };
}

function fillEmployment(state, reason = 'Fictional reason') {
  Object.assign(state.form, { effectiveFrom: '2026-11-14', leaveDate: '2026-11-14', reason });
}

for (const late of [false, true]) test(`new-hire draft matches the selected directory position when directory is ${late ? 'late' : 'ready'}`, async t => {
  const pending = deferred(), original = draft(), before = structuredClone(original);
  const { state, calls } = await mount(t, 'EmployeeCreateDrawer.vue', { draft: original }, {},
    late ? () => pending.promise : undefined);
  if (late) { pending.resolve(directory); await settle(); }
  assert.equal(state.form.employee.position, 'Current title A');
  assert.equal(state.form.employee.jobFamily, 'Current family A');
  await state.submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].employee.position, 'Current title A');
  assert.equal(calls[0].employee.jobFamily, 'Current family A');
  assert.deepEqual(original, before, 'never mutate the saved snapshot');
});

test('submitting before the directory arrives waits for visible and submitted position values to agree', async t => {
  const pending = deferred();
  const { state, calls } = await mount(t, 'EmployeeCreateDrawer.vue', { draft: draft() }, {}, () => pending.promise);
  const submitting = state.submit();
  await settle();
  assert.equal(calls.length, 0);
  pending.resolve(directory);
  await submitting;
  assert.equal(calls.length, 1);
  assert.equal(state.form.employee.position, 'Current title A');
  assert.equal(calls[0].employee.position, 'Current title A');
  assert.equal(calls[0].employee.jobFamily, 'Current family A');
});

test('failed directory loading retains input, blocks submission and can be retried', async t => {
  const pending = deferred();
  let loads = 0;
  const { state, calls } = await mount(t, 'EmployeeCreateDrawer.vue', { draft: draft() }, {},
    () => ++loads === 1 ? pending.promise : Promise.resolve(directory));
  state.form.profile.school = 'Retain school input';
  const submitting = state.submit();
  await settle();
  assert.equal(calls.length, 0);
  pending.reject(new Error('Directory unavailable'));
  await submitting;
  assert.equal(calls.length, 0);
  assert.equal(state.form.profile.school, 'Retain school input');
  assert.ok(state.fieldErrors['employee.positionId']);
  assert.equal(state.checkingStep.value, false);
  await state.submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].employee.position, 'Current title A');
});

test('closing during the directory wait cannot submit or navigate the abandoned new-hire draft', async t => {
  const pending = deferred();
  const { state, props, calls, events } = await mount(t, 'EmployeeCreateDrawer.vue', { draft: draft() }, {}, () => pending.promise);
  const submitting = state.submit();
  await settle();
  props.modelValue = false;
  await settle();
  pending.resolve(directory);
  await submitting;
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
});

test('late directory uses the current draft and preserves unrelated new input', async t => {
  const pending = deferred();
  const { state, props } = await mount(t, 'EmployeeCreateDrawer.vue', { draft: draft() }, {}, () => pending.promise);
  const next = draft({ id: 'draft-b' });
  next.proposedValue.employee.positionId = 'position-b';
  props.draft = next;
  await settle();
  state.form.profile.school = 'New input after switching';
  pending.resolve(directory);
  await settle();
  assert.equal(state.form.employee.position, 'Current title B');
  assert.equal(state.form.employee.jobFamily, '');
  assert.equal(state.form.profile.school, 'New input after switching');
});

test('late directory does not restore a cleared position or erase free-text input', async t => {
  const pending = deferred();
  const { state } = await mount(t, 'EmployeeCreateDrawer.vue', { draft: draft() }, {}, () => pending.promise);
  state.form.positionId = '';
  await settle();
  state.form.employee.position = 'Manual title';
  state.form.employee.jobFamily = 'Manual family';
  pending.resolve(directory);
  await settle();
  assert.equal(state.form.positionId, '');
  assert.equal(state.form.employee.position, 'Manual title');
  assert.equal(state.form.employee.jobFamily, 'Manual family');
});

test('fresh new hire selection takes directory values including an empty family', async t => {
  const { state } = await mount(t, 'EmployeeCreateDrawer.vue', {});
  state.form.positionId = 'position-a';
  await settle();
  assert.equal(state.form.employee.jobFamily, 'Current family A');
  state.form.positionId = 'position-b';
  await settle();
  assert.equal(state.form.employee.position, 'Current title B');
  assert.equal(state.form.employee.jobFamily, '');
});

for (const late of [false, true]) test(`directory ${late ? 'arrival' : 'cache'} does not normalize an established employee snapshot`, async t => {
  const pending = deferred();
  const { state } = await mount(t, 'EmployeeCreateDrawer.vue', { draft: draft({ userId: 'established-employee', appliedAt: '2026-01-01T00:00:00Z' }) }, {},
    late ? () => pending.promise : undefined);
  if (late) { pending.resolve(directory); await settle(); }
  assert.equal(state.form.employee.position, 'Stored old title');
  assert.equal(state.form.employee.jobFamily, 'Stored old family');
});

test('employment history retains its stored position name and family after directory load', async t => {
  const pending = deferred();
  const { state } = await mount(t, 'EmploymentRecordDrawer.vue', { archive: archive(), mode: 'default' }, {}, () => pending.promise);
  pending.resolve(directory);
  await settle();
  assert.equal(state.form.position, 'Historical title');
  assert.equal(state.form.jobFamily, 'Historical family');
});

for (const mode of ['default', 'resignation']) {
  test(`${mode} current submission hands off the request once and blocks duplicate clicks`, async t => {
    const pending = deferred(), calls = [];
    const { state, events, messages } = await mount(t, 'EmploymentRecordDrawer.vue', { archive: archive(), mode }, {
      createEmployment: (id, body) => { calls.push({ id, body }); return pending.promise; },
    });
    fillEmployment(state);
    const submitting = state.submit();
    await state.submit();
    pending.resolve(review());
    await submitting;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, 'employee-a');
    assert.equal(calls[0].body.reason, 'Fictional reason');
    assert.deepEqual(events, [['update:modelValue', false], ['submitted', 'request-a']]);
    assert.equal(messages.filter(([kind]) => kind === 'success').length, 1);
    assert.equal(state.saving.value, false);
  });

  for (const transition of ['close', 'reopen', 'employee', 'mode']) {
    test(`${mode} ignores success after ${transition} without closing or overwriting the current form`, async t => {
      const pending = deferred();
      const { state, props, events, messages } = await mount(t, 'EmploymentRecordDrawer.vue', { archive: archive(), mode }, {
        createEmployment: () => pending.promise,
      });
      fillEmployment(state);
      const submitting = state.submit();
      if (transition === 'close' || transition === 'reopen') {
        props.modelValue = false;
        await settle();
        if (transition === 'reopen') props.modelValue = true;
      } else if (transition === 'employee') props.archive = archive('employee-b');
      else props.mode = mode === 'default' ? 'resignation' : 'default';
      await settle();
      fillEmployment(state, 'New session input');
      pending.resolve(review());
      await submitting;
      assert.deepEqual(events, []);
      assert.deepEqual(messages, []);
      assert.equal(state.resignationReview.value, null);
      assert.equal(state.form.reason, 'New session input');
    });
  }

  for (const outcome of ['resolve', 'reject']) {
    test(`${mode} stale ${outcome} cannot clear a newer submission's saving state`, async t => {
      const first = deferred(), second = deferred(), calls = [];
      const { state, props, events, messages } = await mount(t, 'EmploymentRecordDrawer.vue', { archive: archive(), mode }, {
        createEmployment: (id, body) => { calls.push({ id, body }); return calls.length === 1 ? first.promise : second.promise; },
      });
      fillEmployment(state);
      const oldSubmission = state.submit();
      props.modelValue = false;
      await settle();
      props.archive = archive('employee-b');
      props.modelValue = true;
      await settle();
      fillEmployment(state, 'New employee input');
      assert.equal(state.saving.value, false, 'the new session must not inherit old saving state');
      const newSubmission = state.submit();
      assert.equal(calls.length, 2);
      first[outcome](outcome === 'resolve' ? review() : new Error('Old request failed'));
      await oldSubmission;
      assert.equal(state.saving.value, true);
      assert.equal(state.form.reason, 'New employee input');
      assert.deepEqual(events, []);
      assert.deepEqual(messages, []);
      second.resolve(review('request-b'));
      await newSubmission;
      assert.deepEqual(events, [['update:modelValue', false], ['submitted', 'request-b']]);
      assert.equal(state.saving.value, false);
    });
  }
}

test('switching employee without closing resets the form instead of carrying the prior resignation reason', async t => {
  const { state, props } = await mount(t, 'EmploymentRecordDrawer.vue', { archive: archive(), mode: 'resignation' });
  fillEmployment(state, 'Employee A reason');
  props.archive = archive('employee-b');
  await settle();
  assert.equal(state.form.reason, '');
});

test('refreshing the same employee department preserves the in-progress resignation draft', async t => {
  const { state, props } = await mount(t, 'EmploymentRecordDrawer.vue', { archive: archive(), mode: 'resignation' });
  fillEmployment(state, 'Keep current reason');
  props.archive = { ...archive(), dept: { id: 'updated-department' } };
  await settle();
  assert.equal(state.form.deptId, 'updated-department');
  assert.equal(state.form.reason, 'Keep current reason');
  assert.equal(state.form.leaveDate, '2026-11-14');
});

test('current submission errors retain the input and allow a retry', async t => {
  const { state, events } = await mount(t, 'EmploymentRecordDrawer.vue', { archive: archive(), mode: 'default' }, {
    createEmployment: async () => { throw new Error('Current request failed'); },
  });
  fillEmployment(state);
  await state.submit();
  assert.equal(state.form.reason, 'Fictional reason');
  assert.equal(state.saving.value, false);
  assert.deepEqual(events, []);
});

test('unmounted employment editor ignores its pending submission response', async t => {
  const pending = deferred();
  const { state, events, messages, unmount } = await mount(t, 'EmploymentRecordDrawer.vue', { archive: archive(), mode: 'default' }, {
    createEmployment: () => pending.promise,
  });
  fillEmployment(state);
  const submitting = state.submit();
  unmount();
  pending.resolve(review());
  await submitting;
  assert.deepEqual(events, []);
  assert.deepEqual(messages, []);
});

for (const name of ['EmployeeCreateDrawer.vue', 'EmploymentRecordDrawer.vue']) test(`${name} script and template compile together`, () => {
  const filename = path.join(root, 'views/admin/components', name);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: name });
  const result = compileTemplate({ source: descriptor.template.content, filename, id: name,
    compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(result.errors, []);
});

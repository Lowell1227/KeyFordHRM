const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '../src');
const names = ['EmployeeArchiveInlineEditor.vue', 'EmployeeReentryDrawer.vue', 'EmploymentRecordDrawer.vue'];
const positions = [
  { id: 'old-position', name: 'Old directory position', jobFamily: 'Old family', isActive: false },
  { id: 'active-position', name: 'Active position', jobFamily: 'Engineering', isActive: true },
  { id: 'empty-family', name: 'No family position', jobFamily: null, isActive: true },
  { id: 'other-inactive', name: 'Other inactive', jobFamily: 'Other', isActive: false },
];
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
function archive(status = 'active', positionId = 'old-position') {
  const employment = { company: 'fuede', deptId: 'fixture-dept', positionId, position: 'Historical position',
    jobFamily: 'Historical family', effectiveFrom: '2020-01-01', employeeStatus: status };
  return { id: 'fictional-person', name: 'Fictional employee', employeeNo: 'FIXTURE', status, positionId,
    position: employment.position, dept: { id: 'fixture-dept', name: 'Fixture department' },
    currentEmployment: employment, employmentHistory: [employment], employeeContracts: [] };
}
function review(overrides = {}) {
  return { id: 'fixture-request', sourceType: 'manual_employment_change', recordStatus: 'submitted',
    profileReviewStatus: 'approved', performanceReviewStatus: 'not_required', appliedAt: null,
    proposedValue: { employee: { changeType: 'resignation', leaveDate: '2020-01-01', effectiveFrom: '2020-01-01' } },
    ...overrides };
}
// Real component setup and reactivity; services and renderer are test doubles, not business acceptance.
async function mount(t, name, input, api = {}) {
  const filename = path.join(root, 'views/admin/components', name);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const calls = [], queries = [], events = [];
  const component = load(filename, {
    '@/api/upload.api': { uploadApi: {} },
    '@/api/positions.api': { positionsApi: { findAll: async params => {
      queries.push(params); return positions.filter(row => params?.includeInactive || row.isActive);
    } } },
    '@/api/employee-archives.api': { employeeArchivesApi: {
      getCurrentReentry: async () => null, getArchive: async () => archive('resigned'),
      saveArchiveDraft: async () => null,
      createReentry: async (id, body) => { calls.push(body); return review(); },
      reviseReentry: async (id, body) => { calls.push(body); return review(); },
      createEmployment: async (id, body) => { calls.push(body); return review(); }, ...api,
    } },
    'element-plus': { ElMessage: { info() {}, warning() {}, error() {}, success() {} }, ElMessageBox: { confirm: async () => {} } },
  }, compileScript(descriptor, { id: name }).content).default;
  const props = vue.reactive(input);
  let state;
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { emit: (...args) => events.push(args), expose() {} });
    return () => null;
  } });
  app.mount({});
  t.after(() => app.unmount());
  await vue.nextTick();
  if ('modelValue' in props) { props.modelValue = true; await vue.nextTick(); }
  await new Promise(resolve => setImmediate(resolve));
  return { state, props, events, calls, queries };
}
function employment(t, extra = {}) {
  return mount(t, names[2], { modelValue: false, archive: archive(), departments: [], mode: 'default', ...extra });
}
function reentry(t, api = {}) {
  return mount(t, names[1], { modelValue: false, employee: { ...archive('resigned'), deptId: 'fixture-dept' }, departments: [] }, api);
}
function fillReentry(state) {
  Object.assign(state.form, { company: 'fuede', deptId: 'fixture-dept', effectiveDate: '2026-11-14' });
}

function fieldFailure(fields) {
  return { isAxiosError: true, response: { status: 400, data: { message: 'Invalid fields', data: { fieldErrors: fields } } } };
}
test('F05 server employee/profile errors map aliases, retain inputs and clear only their changed field', async t => {
  const { state } = await mount(t, names[0], { editing: true, archive: archive(), departments: [] });
  state.form.profile.education = 'x'.repeat(51);
  state.form.profile.school = 'Original school';
  state.showWriteError(fieldFailure({ 'profile.education': 'Too long', 'profile.school': 'Check school', 'employee.contractSubjectId': 'Check company' }), true);
  assert.equal(state.form.profile.education.length, 51);
  assert.equal(state.serverFieldErrors['profile.education'], 'Too long');
  assert.equal(state.serverFieldErrors['employee.companyText'], 'Check company');
  state.form.profile.ethnicity = 'Unrelated';
  await vue.nextTick();
  assert.equal(state.serverFieldErrors['profile.school'], 'Check school');
  assert.equal(state.serverFieldErrors['profile.education'], 'Too long');
  state.form.profile.education = 'Corrected';
  await vue.nextTick();
  assert.equal(state.serverFieldErrors['profile.education'], undefined);
  assert.equal(state.serverFieldErrors['profile.school'], 'Check school');
  state.form.employee.contractSubjectId = 'new-company';
  await vue.nextTick();
  assert.equal(state.serverFieldErrors['employee.companyText'], undefined);
  assert.equal(state.serverFieldErrors['profile.school'], 'Check school');
});

test('F05 unresolved server field errors block repeat submit and reset clears them', async t => {
  const { state, events } = await mount(t, names[0], { editing: true, archive: archive(), departments: [] });
  state.form.profile.school = 'Changed school';
  state.showWriteError(fieldFailure({ 'profile.education': 'Too long' }), true);
  await state.submit();
  assert.equal(events.some(event => event[0] === 'submit'), false);
  state.reset();
  assert.deepEqual({ ...state.serverFieldErrors }, {});
});

test('F05 every employee/profile form item binds the local server error', () => {
  const source = fs.readFileSync(path.join(root, 'views/admin/components', names[0]), 'utf8');
  for (const [tag] of source.matchAll(/<el-form-item\b[^>]*data-archive-field="(?:employee|profile)\.[^"]+"[^>]*>/g)) {
    assert.match(tag, /:error=/, tag);
  }
});

test('F03 archive performance manager uses eligibility without changing the roster manager contract', () => {
  const source = fs.readFileSync(path.join(root, 'views/admin/components', names[0]), 'utf8');
  const controls = [...source.matchAll(/<UserSelect\b[^>]*>/g)].map(match => match[0]);
  assert.match(controls.find(item => item.includes('form.performance.managerId')), /eligible-for="direct_manager"/);
  assert.doesNotMatch(controls.find(item => item.includes('form.employee.managerId')), /eligible-for=/);
});

test('F04 inactive historical position is labelled and never an enabled new choice', async t => {
  const { state, queries } = await reentry(t);
  assert.equal(queries.some(query => query?.includeInactive === true), true);
  assert.equal(state.form.positionId, 'old-position');
  const option = state.positionOptions.value.find(row => row.id === 'old-position');
  assert.match(option.name, /Historical position/);
  assert.equal(option.isActive, false);
  assert.equal(state.positionOptions.value.some(row => row.id === 'other-inactive'), false);
  assert.match(state.positionError.value, /重新选择.*清空/);
});

test('F04 inactive position blocks submission until explicitly replaced or cleared', async t => {
  const { state, calls } = await reentry(t);
  fillReentry(state);
  await state.submit();
  assert.equal(calls.length, 0);
  state.changePosition('active-position');
  await state.submit();
  assert.equal(calls[0].positionId, 'active-position');
  state.changePosition(null);
  assert.equal(state.body().positionId, null);
  assert.equal(state.body().position, null);
  assert.equal(state.body().jobFamily, null);
  assert.equal(state.positionError.value, '');
});

test('F04 missing historical position remains human-readable and blocked', async t => {
  const { state } = await reentry(t, { getArchive: async () => archive('resigned', 'missing-position') });
  assert.match(state.positionOptions.value.find(row => row.id === 'missing-position').name, /Historical position/);
  assert.match(state.positionError.value, /重新选择.*清空/);
});

test('F04 explicit cleared request position does not resurrect historical ID', async t => {
  const { state } = await reentry(t);
  state.setFormFromRequest(review({ proposedValue: { employee: { positionId: null, position: null } } }), archive('resigned'));
  assert.equal(state.form.positionId, '');
});

test('F04 performance-only revision does not revalidate approved inactive position', async t => {
  const { state, calls } = await reentry(t, { getCurrentReentry: async () => review({
    intakeType: 'reentry', onboardingStatus: 'effective', performanceReviewStatus: 'rejected',
    proposedValue: { employee: { positionId: 'old-position' }, performance: { managerId: null } },
  }) });
  state.form.performanceManagerId = 'fictional-manager';
  await state.submit();
  assert.deepEqual(calls, [{ performanceOnly: true, performanceManagerId: 'fictional-manager' }]);
});

test('F10 past planned resignation without appliedAt remains waiting', async t => {
  const { state } = await employment(t, { mode: 'resignation', archive: { ...archive(), latestResignationReview: review() } });
  assert.equal(state.resignationEffective.value, false);
  assert.equal(state.resignationStepActive.value, 2);
  assert.equal(state.resignationReviewLabel.value, '已通过，待生效');
});

test('F10 actual appliedAt marks completion even when planned date differs', async t => {
  const { state } = await employment(t, { mode: 'resignation', archive: { ...archive(), latestResignationReview: review({
    appliedAt: '2020-01-02T00:15:00Z', proposedValue: { employee: { changeType: 'resignation', leaveDate: '2099-01-01' } },
  }) } });
  assert.equal(state.resignationEffective.value, true);
  assert.equal(state.resignationStepActive.value, 3);
  assert.match(state.resignationEffectiveDescription.value, /2020/);
});

test('F10 pending and rejected reviews are not marked completed by old dates', async t => {
  for (const status of ['pending', 'rejected']) {
    const { state } = await employment(t, { mode: 'resignation', archive: { ...archive(), latestResignationReview: review({ profileReviewStatus: status }) } });
    assert.equal(state.resignationEffective.value, false);
    assert.equal(state.resignationStepActive.value, 1);
  }
});

test('resignation submit emits its exact request ID', async t => {
  const { state, events } = await employment(t, { mode: 'resignation' });
  state.form.reason = 'Fictional departure';
  await state.submit();
  assert.deepEqual(events.find(event => event[0] === 'submitted'), ['submitted', 'fixture-request']);
});

test('resignation submission closes the editor before handing the request to the application detail', async t => {
  const { state, events } = await employment(t, { mode: 'resignation' });
  state.form.reason = 'Fictional departure';
  await state.submit();
  assert.deepEqual(events.filter(event => ['update:modelValue', 'submitted'].includes(event[0])), [
    ['update:modelValue', false], ['submitted', 'fixture-request'],
  ]);
});

test('failed resignation submission retains input and does not close or hand off', async t => {
  const { state, events } = await mount(t, names[2], { modelValue: false, archive: archive(), departments: [], mode: 'resignation' }, {
    createEmployment: async () => { throw new Error('Fixture rejected'); },
  });
  state.form.reason = 'Keep this input';
  await state.submit();
  assert.equal(state.form.reason, 'Keep this input');
  assert.deepEqual(events, []);
});

test('F01 current ordinary employment cannot submit resigned status or lifecycle change types', async t => {
  const { state, calls } = await employment(t);
  state.form.effectiveFrom = '2026-11-14';
  for (const patch of [
    { employeeStatus: 'resigned', changeType: 'transfer' },
    { employeeStatus: 'active', changeType: 'resignation' },
    { employeeStatus: 'active', changeType: 'rehire' },
  ]) {
    Object.assign(state.form, patch);
    await state.submit();
  }
  assert.equal(calls.length, 0);
});

test('F01 historical resigned and rehire submissions retain their closed date interval', async t => {
  const { state, calls } = await employment(t, { archive: archive('resigned') });
  Object.assign(state.form, { effectiveFrom: '2020-01-01', effectiveTo: '2020-02-01', employeeStatus: 'active', changeType: 'rehire' });
  await state.submit();
  Object.assign(state.form, { employeeStatus: 'resigned', changeType: 'data_correction' });
  await state.submit();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].effectiveTo, '2020-02-01');
  assert.equal(calls[1].employeeStatus, 'resigned');
});

test('F01 changing a historical range back to open-ended cannot retain a lifecycle bypass', async t => {
  const { state, calls } = await employment(t, { archive: archive('resigned') });
  Object.assign(state.form, { effectiveFrom: '2020-01-01', effectiveTo: '2020-02-01', employeeStatus: 'active', changeType: 'data_correction' });
  await state.submit();
  state.form.effectiveTo = null;
  await state.submit();
  assert.equal(calls.length, 1);
});

for (const name of names) {
  test(`D01 ${name} opening and unrelated edits preserve the same-position historical family`, async t => {
    const historical = archive('active', 'active-position');
    const { state } = name === names[0]
      ? await mount(t, name, { editing: true, archive: historical, departments: [] })
      : name === names[1] ? await reentry(t, { getArchive: async () => historical })
        : await employment(t, { archive: historical });
    const form = name === names[0] ? state.form.employee : state.form;
    form.workLocation = 'Unrelated edit';
    await vue.nextTick();
    const body = name === names[0] ? state.changePayload().employee : name === names[1] ? state.body() : state.form;
    assert.equal(body.positionId, 'active-position');
    assert.equal(body.jobFamily, 'Historical family');
  });
  test(`D01 ${name} carries directory name/family on switch and clears both`, async t => {
    const context = name === names[0]
      ? await mount(t, name, { editing: true, archive: archive(), departments: [] })
      : name === names[1] ? await reentry(t) : await employment(t);
    const state = context.state;
    const body = () => name === names[0] ? state.changePayload().employee : name === names[1] ? state.body() : state.form;
    state.changePosition('active-position');
    assert.equal(body().position, 'Active position');
    assert.equal(body().jobFamily, 'Engineering');
    state.changePosition('empty-family');
    assert.equal(body().jobFamily, null);
    state.changePosition(null);
    assert.equal(body().position, null);
    assert.equal(body().jobFamily, null);
  });
  test(`D01 ${name} preserves historical free text without a position ID`, async t => {
    const historical = archive('active', null);
    const { state } = name === names[0]
      ? await mount(t, name, { editing: true, archive: historical, departments: [] })
      : name === names[1] ? await reentry(t, { getArchive: async () => historical })
        : await employment(t, { archive: historical });
    const body = name === names[0] ? state.changePayload().employee : name === names[1] ? state.body() : state.form;
    assert.equal(body.position, 'Historical position');
    assert.equal(body.jobFamily, 'Historical family');
  });
  test(`${name} template compiles`, () => {
    const filename = path.join(root, 'views/admin/components', name);
    const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: name }).errors, []);
  });
}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '../src');
function load(filename, dependencies = {}, source = fs.readFileSync(filename, 'utf8')) {
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
const { validateOnboardingStep } = load(path.join(root, 'utils/onboarding-validation.ts'));
const { employeeReviewValueDisplay } = load(path.join(root, 'views/admin/components/employee-review-differences.ts'));
const renderer = vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
function archive(contracts = [], id = 'fictional-employee') {
  return { id, name: '虚构员工', status: 'active', employmentHistory: [], employeeContracts: contracts };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function material(name = '合同.pdf') { return { name, url: `/fixture/${name}`, size: 123, mimeType: 'application/pdf' }; }
function options(name = '合同.pdf') {
  return { file: new File(['fixture'], name, { type: 'application/pdf' }), onSuccess() {}, onError() {} };
}

// Real component setup/reactivity, stubbed services and renderer: technical checks, not browser acceptance.
async function mount(t, name, input, upload = async () => material(), api = {}) {
  const filename = path.join(root, 'views/admin/components', name);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const calls = [];
  const component = load(filename, {
    '@/stores/auth.store': { useAuthStore: () => ({ user: { sysRole: 'hr' } }) },
    '@/api/upload.api': { uploadApi: { upload } },
    '@/api/positions.api': { positionsApi: { findAll: async () => [{ id: 'fixture-position', name: '虚构岗位', isActive: true }] } },
    '@/api/employee-archives.api': { employeeArchivesApi: {
      saveArchiveDraft: async () => ({ id: 'draft', requestVersion: 1 }),
      saveEmployeeCreateDraft: async () => ({ id: 'draft', requestVersion: 1 }),
      createEmployee: async body => { calls.push(body); return { id: 'created' }; },
      ...api,
    } },
    'element-plus': { ElMessage: { info() {}, warning() {}, error() {}, success() {} }, ElMessageBox: { confirm: async () => {} } },
  }, compileScript(descriptor, { id: name }).content).default;
  const props = vue.reactive(input), events = [];
  let state;
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { emit: (...args) => events.push(args), expose() {} });
    return () => null;
  } });
  app.mount({});
  t.after(() => app.unmount());
  await vue.nextTick();
  return { state, props, events, calls };
}
async function editor(t, contracts = [], upload) {
  return mount(t, 'EmployeeArchiveInlineEditor.vue', { editing: true, archive: archive(contracts), departments: [] }, upload);
}
async function drawer(t, upload, api) {
  const context = await mount(t, 'EmployeeCreateDrawer.vue', { modelValue: true, departments: [] }, upload, api);
  Object.assign(context.state.form, {
    name: '虚构新员工', company: 'fuede', deptId: 'fixture-dept', positionId: 'fixture-position', entryDate: '2026-11-14', effectiveFrom: '2026-11-14',
  });
  context.state.form.employee.companyText = '虚构公司';
  await vue.nextTick();
  return context;
}

test('onboarding rejects reversed dates but accepts late signing, leap days and missing optional dates', () => {
  assert.equal(validateOnboardingStep({ contracts: [{ effectiveFrom: '2026-12-01', expiresAt: '2026-11-30' }] }, 2)['contracts.0.expiresAt'], '到期日期不能早于生效日期');
  assert.deepEqual(validateOnboardingStep({ contracts: [{ signedAt: '2026-12-10', effectiveFrom: '2026-12-01', expiresAt: '2028-02-29' }, {}] }, 2), {});
  for (const value of ['2026-02-29', '2026-02-31', '0000-01-01', '2026-13-01']) {
    assert.equal(validateOnboardingStep({ contracts: [{ signedAt: value }] }, 2)['contracts.0.signedAt'], '请填写有效日期');
  }
});

test('all review entry points use first signing, renewal and transfer type labels while legacy types remain readable', () => {
  for (const [value, label] of Object.entries({ contract: '首签', renewal: '续签', transfer: '转签', attachment: '附件', confidentiality: '保密协议', unclassified: '待分类合同' })) {
    assert.equal(employeeReviewValueDisplay('contractType', value, {}), label);
  }
});

test('archive blocks invalid and reversed contract dates at their fields before emitting submit', async t => {
  const { state, events } = await editor(t);
  state.addContract();
  Object.assign(state.form.contracts[0], { signedAt: '2026-02-31', effectiveFrom: '2026-12-01', expiresAt: '2026-11-01' });
  await state.submit();
  assert.equal(events.some(event => event[0] === 'submit'), false);
  assert.equal(state.contractErrors.value['contracts.0.signedAt'], '请填写有效日期');
  assert.equal(state.contractErrors.value['contracts.0.expiresAt'], '到期日期不能早于生效日期');
  Object.assign(state.form.contracts[0], { signedAt: '2026-12-10', expiresAt: '2027-12-01' });
  await state.submit();
  assert.equal(events.filter(event => event[0] === 'submit').length, 1);
});

test('unrelated archive edits do not require dates on unchanged historical contracts', async t => {
  const { state, events } = await editor(t, [{ id: 'legacy', contractType: 'unclassified', signedAt: null, effectiveFrom: null, expiresAt: null }]);
  state.form.profile.school = '虚构学校';
  await state.submit();
  assert.equal(events.filter(event => event[0] === 'submit').length, 1);
  assert.equal(events.find(event => event[0] === 'submit')[1].contracts[0].effectiveFrom, null);
});

for (const [name, setup] of [['archive', editor], ['onboarding', drawer]]) {
  const mountForm = (t, upload) => name === 'archive' ? setup(t, [], upload) : setup(t, upload);
  test(`${name} blocks pending uploads and admits the completed attachment`, async t => {
    const pending = deferred();
    const { state, events, calls } = await mountForm(t, () => pending.promise);
    state.addContract();
    const contract = state.form.contracts[0];
    const upload = state.uploadContractAttachment(contract, options());
    await state.submit();
    assert.equal(events.some(event => event[0] === 'submit'), false);
    assert.equal(calls.length, 0);
    pending.resolve(material());
    await upload;
    await state.submit();
    const payload = name === 'archive' ? events.find(event => event[0] === 'submit')?.[1] : calls[0];
    assert.equal(payload.contracts[0].attachments.length, 1);
  });

  test(`${name} failed upload stays blocking until retried successfully or removed`, async t => {
    let fail = true;
    const { state, calls, events } = await mountForm(t, async () => { if (fail) throw new Error('fixture failure'); return material(); });
    state.addContract();
    const contract = state.form.contracts[0];
    await state.uploadContractAttachment(contract, options()).catch(() => {});
    await state.submit();
    assert.equal(events.some(event => event[0] === 'submit'), false);
    assert.equal(calls.length, 0);
    const task = state.contractUploads.forContract(contract)[0];
    assert.equal(task.status, 'failed');
    fail = false;
    await state.contractUploads.retry(task);
    assert.equal(state.contractUploads.blocked.value, false);
    assert.equal(contract.attachments.length, 1);
    fail = true;
    await state.uploadContractAttachment(contract, options('第二份.pdf')).catch(() => {});
    state.contractUploads.remove(state.contractUploads.forContract(contract)[0]);
    assert.equal(state.contractUploads.blocked.value, false);
    await state.submit();
    assert.equal(name === 'archive' ? events.filter(event => event[0] === 'submit').length : calls.length, 1);
  });

  test(`${name} capacity includes pending uploads for attachments and images`, async t => {
    for (const [kind, limit, handler] of [['attachments', 10, 'uploadContractAttachment'], ['images', 5, 'uploadContractImage']]) {
      const pending = deferred(); let count = 0;
      const { state } = await mountForm(t, () => { count++; return pending.promise; });
      state.addContract();
      const contract = state.form.contracts[0];
      contract[kind] = Array.from({ length: limit - 1 }, (_, index) => material(`${index}.pdf`));
      const input = kind === 'images' ? { ...options(), file: new File(['fixture'], '图.png', { type: 'image/png' }) } : options();
      const first = state[handler](contract, input);
      const second = state[handler](contract, input);
      assert.equal(count, 1);
      pending.resolve(material());
      await Promise.allSettled([first, second]);
      assert.equal(contract[kind].length, limit);
    }
  });

  test(`${name} closing or changing records discards late uploads`, async t => {
    const pending = deferred();
    const { state, props } = await mountForm(t, () => pending.promise);
    state.addContract();
    const old = state.form.contracts[0];
    const upload = state.uploadContractAttachment(old, options());
    if (name === 'archive') props.archive = archive([], 'other-employee');
    else props.modelValue = false;
    await vue.nextTick();
    pending.resolve(material());
    await upload;
    assert.equal(old.attachments.length, 0);
    assert.equal(state.contractUploads.blocked.value, false);
  });
}

test('existing contract removal is reversible; unsaved rows are removed immediately without leaking UI flags', async t => {
  const { state } = await editor(t, [{ id: 'existing', name: '原合同', signedAt: '2026-11-14', attachments: [material()] }]);
  const existing = state.form.contracts[0];
  state.removeContract(existing);
  assert.equal(state.form.contracts.length, 1);
  assert.equal(existing.__removed, true);
  assert.equal(state.changePayload().contracts.length, 0);
  state.restoreContract(existing);
  assert.equal(state.changePayload().contracts[0].id, 'existing');
  assert.equal(state.changePayload().contracts[0].attachments.length, 1);
  assert.equal('__removed' in state.changePayload().contracts[0], false);
  state.addContract();
  state.removeContract(state.form.contracts[1]);
  assert.equal(state.form.contracts.length, 1);
});

async function detail(t, before, after) {
  return mount(t, 'EmployeeApplicationDetail.vue', { request: {
    id: 'fixture-review', sourceType: 'manual_archive_change', baseValue: { contracts: before }, proposedValue: after,
    recordStatus: 'submitted', profileReviewStatus: 'approved', performanceReviewStatus: 'not_required', events: [],
  } });
}
test('detail shows the full added contract summary including agreements, dates and named files', async t => {
  const { state } = await detail(t, [], { contracts: [{ contractType: 'contract', name: '劳动合同', signingCompany: '虚构公司',
    effectiveFrom: '2026-11-14', expiresAt: '2027-11-14', termType: '固定期限', confidentialityAgreement: '已签保密协议', attachments: [material()] }] });
  const items = state.contractChangeItems.value;
  for (const expected of ['2026-11-14', '2027-11-14', '固定期限', '已签保密协议', '合同.pdf', '首签']) {
    assert.ok(items.some(item => item.after.includes(expected)), expected);
  }
});
test('detail normalizes calendar dates, names replaced files and does not treat omitted contracts as removal', async t => {
  const base = { id: 'contract', name: '劳动合同', signedAt: '2026-11-14T00:00:00.000Z', attachments: [material('旧文件.pdf')] };
  const { state } = await detail(t, [base], { contracts: [{ ...base, signedAt: '2026-11-14', attachments: [material('新文件.pdf')] }] });
  assert.equal(state.contractChangeItems.value.some(item => item.label.includes('签订日期')), false);
  assert.ok(state.contractChangeItems.value.some(item => item.before.includes('旧文件.pdf')));
  assert.ok(state.contractChangeItems.value.some(item => item.after.includes('新文件.pdf')));
  const omitted = await detail(t, [base], { employee: { name: '新姓名' } });
  assert.deepEqual(omitted.state.contractChangeItems.value, []);
});

test('both templates label contract as first signing and expose local date errors and upload recovery actions', () => {
  for (const name of ['EmployeeArchiveInlineEditor.vue', 'EmployeeCreateDrawer.vue']) {
    const filename = path.join(root, 'views/admin/components', name);
    const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: name }).errors, []);
    const fields = name === 'EmployeeArchiveInlineEditor.vue'
      ? fs.readFileSync(path.join(root, 'views/admin/components/EmployeeContractFields.vue'), 'utf8') : descriptor.template.content;
    assert.match(fields, name === 'EmployeeArchiveInlineEditor.vue' ? /value: 'contract', label: '首签'/ : /label="首签" value="contract"/);
    assert.match(descriptor.template.content, /contractUploads\.retry/);
    assert.match(descriptor.template.content, /contractUploads\.remove/);
    for (const field of ['signedAt', 'effectiveFrom', 'expiresAt']) {
      assert.match(fields, new RegExp(':error="[^"\\n]*' + field));
    }
  }
});

test('both contract forms use strict controls only for contract dates and show transfer company fields conditionally', () => {
  for (const name of ['EmployeeArchiveInlineEditor.vue', 'EmployeeCreateDrawer.vue']) {
    const source = fs.readFileSync(path.join(root, 'views/admin/components', name), 'utf8');
    const fields = name === 'EmployeeArchiveInlineEditor.vue'
      ? fs.readFileSync(path.join(root, 'views/admin/components/EmployeeContractFields.vue'), 'utf8') : source;
    for (const field of ['signedAt', 'effectiveFrom', 'expiresAt']) {
      assert.match(fields, new RegExp('<ContractDateInput v-model="contract\\.' + field + '"'));
    }
    for (const field of ['originalCompany', 'newCompany']) {
      assert.ok(fields.includes(field === 'newCompany' && name === 'EmployeeArchiveInlineEditor.vue'
        ? `v-if="contract.contractType !== 'transfer' && contract.newCompany"`
        : `v-if="contract.contractType === 'transfer' || contract.${field}"`));
    }
    assert.match(source, /<el-date-picker v-model="form\.(?:employee\.entryDate|entryDate)"/);
  }
});

function fieldError(fields) {
  return { isAxiosError: true, response: { status: 400, data: { code: 4001, message: '合同资料有误', data: { fieldErrors: fields } } } };
}
test('archive maps API contract errors past pending removal rows and clears stale server errors on edit', async t => {
  const { state } = await editor(t, [{ id: 'removed', name: '待移除原合同' }, { id: 'kept', name: '保留合同' }]);
  state.removeContract(state.form.contracts[0]);
  await state.submit();
  state.showWriteError(fieldError({ 'contracts.0.name': '合同内容重复', 'contracts.0': '请核对该合同' }), true);
  assert.equal(state.contractErrors.value['contracts.1.name'], '合同内容重复');
  assert.equal(state.contractErrors.value['contracts.1'], '请核对该合同');
  assert.equal(state.contractErrors.value['contracts.0.name'], undefined);
  state.form.contracts[1].name = '更正后合同';
  await vue.nextTick();
  assert.equal(state.contractErrors.value['contracts.1.name'], undefined);
});
test('onboarding displays API duplicate errors at the contract name and opens the contract step', async t => {
  const { state } = await drawer(t, undefined, { createEmployee: async () => { throw fieldError({ 'contracts.0.name': '合同内容重复' }); } });
  state.addContract();
  await state.submit();
  assert.equal(state.currentStep.value, 2);
  assert.equal(state.fieldErrors['contracts.0.name'], '合同内容重复');
  assert.ok(state.supplementGroups.value.includes('contracts'));
});
test('archive emits the existing blocked signal for upload and retry states, without losing conflict blocking', async t => {
  const pending = deferred();
  const { state, events } = await editor(t, [], () => pending.promise);
  state.addContract();
  const upload = state.uploadContractAttachment(state.form.contracts[0], options());
  await vue.nextTick();
  assert.deepEqual(events.filter(event => event[0] === 'blocked').at(-1), ['blocked', true]);
  state.showWriteError({ isAxiosError: true, response: { status: 409 } });
  pending.resolve(material());
  await upload;
  await vue.nextTick();
  assert.deepEqual(events.filter(event => event[0] === 'blocked').at(-1), ['blocked', true]);
});

test('detail lists material additions and removals without claiming unchanged files changed', async t => {
  const kept = material('保留.pdf'), removed = material('替换.pdf');
  const added = { ...removed, url: '/fixture/replacement.pdf' };
  const base = { id: 'contract', name: '合同', attachments: [kept, removed] };
  const { state } = await detail(t, [base], { contracts: [{ ...base, attachments: [kept, added] }] });
  const rows = state.contractChangeItems.value.filter(row => row.label.includes('附件'));
  assert.equal(rows.length, 2);
  assert.ok(rows.some(row => row.label.includes('移除') && row.before === '替换.pdf'));
  assert.ok(rows.some(row => row.label.includes('新增') && row.after === '替换.pdf'));
  assert.equal(rows.some(row => row.before.includes('保留.pdf') || row.after.includes('保留.pdf')), false);
});
test('onboarding retains the API message fallback when DTO validation has no fieldErrors', async t => {
  const { state } = await drawer(t, undefined, { createEmployee: async () => { throw { isAxiosError: true, response: { status: 400, data: { message: ['合同日期无效'] } } }; } });
  await state.submit();
  assert.match(state.saveError.value, /合同日期无效/);
});
test('removing and restoring an existing contract never accepts a pre-removal upload callback', async t => {
  const pending = deferred();
  const { state } = await editor(t, [{ id: 'existing', attachments: [] }], () => pending.promise);
  const contract = state.form.contracts[0];
  const upload = state.uploadContractAttachment(contract, options());
  state.removeContract(contract);
  state.restoreContract(contract);
  pending.resolve(material());
  await upload;
  assert.deepEqual(contract.attachments, []);
});

test('contract action renewal opens only its new row and preserves the source and employee company', async t => {
  const { state } = await editor(t, [{ id: 'source', contractType: 'contract', name: '劳动合同',
    signingCompany: '虚构签约公司', contractSubjectId: 'subject-a', effectiveFrom: '2025-01-01', expiresAt: '2026-12-31' }]);
  state.form.employee.companyText = '虚构所属公司';
  const before = JSON.stringify(state.form.contracts[0]);
  await state.beginContractAction('renew', 'source');
  const renewal = state.form.contracts[1];
  assert.equal(renewal.contractType, 'renewal');
  assert.equal(renewal.name, '劳动合同');
  assert.equal(renewal.contractSubjectId, 'subject-a');
  assert.equal(renewal.signingCompany, '虚构签约公司');
  assert.equal(renewal.id, undefined);
  assert.equal(renewal.effectiveFrom, null);
  assert.equal(state.expandedContractKey.value, renewal.__key);
  assert.equal(JSON.stringify(state.form.contracts[0]), before);
  assert.equal(state.form.employee.companyText, '虚构所属公司');
});

test('contract actions resume the whole draft without losing unrelated edits or other contracts', async t => {
  const existing = { id: 'source', contractType: 'contract', name: '原合同', signingCompany: '虚构公司' };
  const { state, events } = await mount(t, 'EmployeeArchiveInlineEditor.vue', {
    editing: true, contractOnly: true, archive: archive([existing]), departments: [],
    draft: { id: 'draft-existing', userId: 'fictional-employee', recordStatus: 'draft', requestVersion: 3,
      proposedValue: { profile: { school: '草稿中的学校' }, contracts: [{ ...existing, name: '草稿中的合同名' }] } },
  });
  await state.beginContractAction('materials', 'source');
  assert.equal(events.some(event => event[0] === 'whole-archive'), true);
  assert.equal(state.form.contracts.length, 1);
  assert.equal(state.form.contracts[0].name, '草稿中的合同名');
  assert.equal(state.contractAction.value, 'materials');
  assert.equal(state.changePayload().profile.school, '草稿中的学校');
  assert.equal(state.changePayload().draftId, 'draft-existing');
  assert.equal(state.changePayload().expectedVersion, 3);
  await state.beginContractAction('transfer', 'source');
  assert.equal(state.form.contracts[1].originalCompany, '虚构公司');
  assert.equal(state.form.contracts[1].contractType, 'transfer');
  assert.equal(state.form.contracts[1].signingCompany, '');
  assert.equal(state.form.contracts[1].contractSubjectId, undefined);
});

test('transfer company selection updates the new company and shows exact subject field errors', async t => {
  const contract = { contractType: 'transfer', originalCompany: '原签约公司', signingCompany: '新签约公司', contractSubjectId: 'subject-b', newCompany: '' };
  const { state } = await mount(t, 'EmployeeContractFields.vue', { contract, index: 2,
    errors: { 'contracts.2.contractSubjectId': '该公司已停用，请选择启用公司' }, imageCount: 0, attachmentCount: 0 });
  assert.equal(state.error('signingCompany'), '该公司已停用，请选择启用公司');
  state.selectSigningCompany({ id: 'subject-b', name: '新签约公司' });
  assert.equal(contract.newCompany, '新签约公司');
  assert.equal(contract.originalCompany, '原签约公司');
});

test('a direct delete remains reversible and never deletes a different contract', async t => {
  const { state } = await editor(t, [{ id: 'first', name: '第一份' }, { id: 'second', name: '第二份' }]);
  await state.beginContractAction('remove', 'first');
  assert.equal(state.form.contracts[0].__removed, true);
  assert.deepEqual(state.changePayload().contracts.map(item => item.id), ['second']);
  state.restoreContract(state.form.contracts[0]);
  assert.deepEqual(state.changePayload().contracts.map(item => item.id), ['first', 'second']);
});

test('renewal never combines an unlinked historical company name with the employee current company ID', async t => {
  const { state } = await editor(t, [{ id: 'legacy-company', contractType: 'contract', signingCompany: '历史原文公司' }]);
  state.form.employee.companyText = '现在所属公司';
  state.form.employee.contractSubjectId = 'current-subject';
  await state.beginContractAction('renew', 'legacy-company');
  assert.equal(state.form.contracts[1].signingCompany, '历史原文公司');
  assert.equal(state.form.contracts[1].contractSubjectId, undefined);
});

test('resuming a pure contract draft keeps its deleted rows visible for undo', async t => {
  const existing = [{ id: 'first', name: '误录合同' }, { id: 'second', name: '保留合同' }];
  const { state, events } = await mount(t, 'EmployeeArchiveInlineEditor.vue', {
    editing: true, contractOnly: true, archive: archive(existing), departments: [],
    draft: { id: 'delete-draft', userId: 'fictional-employee', recordStatus: 'draft', requestVersion: 2,
      proposedValue: { contracts: [existing[1]] } },
  });
  await state.beginContractAction('edit');
  const deleted = state.form.contracts.find(item => item.id === 'first');
  assert.equal(deleted.__removed, true);
  assert.equal(state.expandedContractKey.value, deleted.__key);
  assert.equal(events.some(event => event[0] === 'whole-archive'), false);
  state.restoreContract(deleted);
  assert.deepEqual(state.changePayload().contracts.map(item => item.id).sort(), ['first', 'second']);
});

test('unchanged server snapshot fields do not expand a contract draft into unrelated archive editing', async t => {
  const baseline = { name: '虚构员工', effectiveFrom: '2020-01-01T00:00:00.000Z', deptName: '虚构部门', changeType: 'onboarding' };
  const { state, events } = await mount(t, 'EmployeeArchiveInlineEditor.vue', {
    editing: true, contractOnly: true, archive: archive(), departments: [],
    draft: { id: 'normalized-draft', userId: 'fictional-employee', recordStatus: 'draft', requestVersion: 1,
      baseValue: { employee: baseline, profile: { phone: null }, performance: { managerId: null } },
      proposedValue: { employee: { ...baseline, effectiveFrom: '2020-01-01' }, profile: { phone: '' }, performance: { managerId: null },
        contracts: [{ name: '补录合同', contractType: 'contract' }] } },
  });
  await state.beginContractAction('edit');
  assert.equal(state.draftHasOtherChanges.value, false);
  assert.equal(events.some(event => event[0] === 'whole-archive'), false);
});

test('redacted identity and bank replacements restore whole-archive mode and disclose the pending fields', async t => {
  const profile = { idNumberConfigured: true, bankAccountConfigured: true };
  const input = {
    editing: true, contractOnly: true, archive: archive(), departments: [],
    draft: { id: 'redacted-draft', userId: 'fictional-employee', recordStatus: 'draft', requestVersion: 1,
      profileReviewStatus: 'pending', changedFields: ['profile.idNumber', 'profile.bankAccount'],
      baseValue: { profile }, proposedValue: { profile, contracts: [] } },
  };
  const { state, events, props } = await mount(t, 'EmployeeArchiveInlineEditor.vue', input);
  await state.beginContractAction('create');
  assert.equal(state.draftHasOtherChanges.value, true);
  assert.deepEqual(state.pendingSensitiveFields.value, ['身份证号', '银行卡号']);
  assert.equal(events.some(event => event[0] === 'whole-archive'), true);
  props.draft.profileReviewStatus = 'approved';
  state.reset();
  await vue.nextTick();
  assert.deepEqual(state.pendingSensitiveFields.value, []);
  assert.equal(state.draftHasOtherChanges.value, false);
});

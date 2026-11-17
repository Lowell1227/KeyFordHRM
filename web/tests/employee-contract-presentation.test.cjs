const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadTs(filename, source = fs.readFileSync(filename, 'utf8'), dependencies = {}) {
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = id => id in dependencies ? dependencies[id] : id.startsWith('@/')
    ? loadTs(path.resolve(__dirname, '../src', `${id.slice(2)}.ts`))
    : id.startsWith('.') ? loadTs(path.resolve(path.dirname(filename), `${id}.ts`)) : originalRequire(id);
  loaded._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return loaded.exports;
}
const { contractTitle, sortContractsLatestFirst, selectEmployeeContracts, groupEmployeeContracts, overlappingContractIds } = loadTs(path.resolve(__dirname, '../src/utils/employee-contract-presentation.ts'));
const { employeeContractStatus } = loadTs(path.resolve(__dirname, '../src/utils/employee-contract-status.ts'));

test('contract titles retain their name and signing day when list order changes', () => {
  const contract = { id: 'fixture-contract', name: '研发劳动合同', signedAt: '2026-11-12T00:00:00.000Z', effectiveFrom: '2026-12-01' };
  assert.equal(contractTitle(contract), '研发劳动合同 · 2026-11-12 签订');
  assert.equal(contractTitle(sortContractsLatestFirst([{}, contract])[0]), contractTitle(contract));
});

test('unnamed contracts use their type and effective date without inventing a number', () => {
  assert.equal(contractTitle({ contractType: 'renewal', effectiveFrom: '2026-12-01' }), '续签合同 · 2026-12-01 生效');
  assert.equal(contractTitle({ contractType: 'transfer' }), '转签合同 · 日期待补充');
  assert.equal(contractTitle({}), '合同 · 日期待补充');
  assert.equal(contractTitle({ name: '  ', signedAt: '2026-02-30', effectiveFrom: '2026-03-01' }), '合同 · 2026-03-01 生效');
});

test('import proposals and formal records share the same Chinese contract type titles', () => {
  const labels = {
    contract: '劳动合同', renewal: '续签合同', transfer: '转签合同',
    attachment: '附件', unclassified: '待分类合同', confidentiality: '保密协议',
  };
  for (const [type, label] of Object.entries(labels)) {
    const proposal = { kind: type, signedAt: '2026-11-12' };
    const formal = { contractType: type, signedAt: '2026-11-12' };
    assert.equal(contractTitle(proposal), `${label} · 2026-11-12 签订`);
    assert.equal(contractTitle(formal), contractTitle(proposal));
  }
  assert.equal(contractTitle({ contractType: 'renewal', kind: 'transfer' }), '续签合同 · 日期待补充');
});

test('current presentation sorts by effective day, using signing day only for missing legacy dates', () => {
  const input = [
    { id: 'old', signedAt: '2024-01-01', effectiveFrom: '2028-01-01' },
    { id: 'effective-only', effectiveFrom: '2026-12-01' },
    { id: 'latest', signedAt: '2027-01-01' },
    { id: 'undated' },
  ];
  assert.deepEqual(sortContractsLatestFirst(input).map(item => item.id), ['old', 'effective-only', 'latest', 'undated']);
});

test('an undated legacy signature cannot displace a transfer with a known effective day', () => {
  const old = { id: 'old', contractType: 'contract', signedAt: '2026-11-12', effectiveFrom: null };
  const transfer = { id: 'transfer', contractType: 'transfer', effectiveFrom: '2026-11-01' };
  assert.equal(selectEmployeeContracts([old, transfer]).current, transfer);
  assert.equal(selectEmployeeContracts([old]).current, old);
  assert.equal(employeeContractStatus(old).label, '待核实');
});

test('a backdated signature does not put an earlier first contract ahead of its transfer', () => {
  const input = [
    { id: 'initial', contractType: 'contract', signedAt: '2026-11-12', effectiveFrom: '2026-08-01' },
    { id: 'transfer', contractType: 'transfer', signedAt: '2026-11-01', effectiveFrom: '2026-11-01' },
    { id: 'removed', contractType: 'renewal', effectiveFrom: '2028-01-01', isActive: false },
    { id: 'material', contractType: 'attachment', effectiveFrom: '2029-01-01' },
  ];
  const groups = selectEmployeeContracts(input);
  assert.equal(groups.current.id, 'transfer');
  assert.deepEqual(groups.history.map(item => item.id), ['material', 'removed', 'initial']);
});

test('a pending current contract stays in the same group while only its business-day status changes', () => {
  const contract = { id: 'future', contractType: 'renewal', effectiveFrom: '2026-12-01', expiresAt: '2029-11-30' };
  assert.equal(selectEmployeeContracts([contract]).current, contract);
  assert.equal(employeeContractStatus(contract, new Date('2026-11-30T15:59:59Z')).label, '待生效');
  assert.equal(employeeContractStatus(contract, new Date('2026-11-30T16:00:00Z')).label, '期限内');
  assert.equal(employeeContractStatus(contract, new Date('2029-11-30T16:00:00Z')).label, '已到期');
  assert.equal(employeeContractStatus({ ...contract, isActive: false }).label, '历史保留记录');
});

const auditDay = new Date('2026-11-17T04:00:00Z');
test('date groups keep today and future contracts visible and separate retained records', () => {
  const input = Object.freeze([
    Object.freeze({ id: 'today', contractType: 'contract', effectiveFrom: '2026-01-01', expiresAt: '2026-12-31' }),
    Object.freeze({ id: 'future', contractType: 'renewal', effectiveFrom: '2027-01-01', expiresAt: '2029-12-31' }),
    Object.freeze({ id: 'expired', contractType: 'contract', effectiveFrom: '2024-01-01', expiresAt: '2025-12-31' }),
    Object.freeze({ id: 'unknown', contractType: 'contract', signedAt: '2026-11-17' }),
    Object.freeze({ id: 'removed', contractType: 'renewal', effectiveFrom: '2026-01-01', expiresAt: '2028-12-31', isActive: false, recordState: 'removed' }),
  ]);
  const groups = groupEmployeeContracts(input, auditDay);
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.map(row => row.id)])), {
    withinTerm: ['today'], upcoming: ['future'], needsReview: ['unknown'], history: ['expired'], retained: ['removed'],
  });
  assert.equal(input[0].expiresAt, '2026-12-31');
});

test('open-ended term is a term type and can be within term or upcoming', () => {
  const contract = { effectiveFrom: '2026-01-01', termType: '无固定期限' };
  assert.equal(employeeContractStatus(contract, auditDay).key, 'within_term');
  assert.equal(employeeContractStatus({ ...contract, effectiveFrom: '2027-01-01' }, auditDay).key, 'upcoming');
  assert.equal(employeeContractStatus({ ...contract, effectiveFrom: null }, auditDay).key, 'needs_review');
});

test('missing and contradictory dates explain what must be checked without guessing', () => {
  for (const [contract, reason] of [
    [{ expiresAt: '2025-01-01' }, '生效日期'],
    [{ effectiveFrom: '2026-01-01' }, '到期日期'],
    [{ effectiveFrom: '2026-02-30', expiresAt: '2027-01-01' }, '日期格式'],
    [{ effectiveFrom: '0000-01-01', expiresAt: '2027-01-01' }, '日期格式'],
    [{ effectiveFrom: '2027-01-01', expiresAt: '2026-01-01' }, '早于'],
    [{ effectiveFrom: '2026-01-01', expiresAt: '2027-01-01', termType: '无固定期限' }, '无固定期限'],
  ]) {
    const status = employeeContractStatus(contract, auditDay);
    assert.equal(status.key, 'needs_review');
    assert.ok(status.reason.includes(reason), status.reason);
  }
});

test('contract date status respects inclusive end date and Shanghai midnight', () => {
  const contract = { effectiveFrom: '2026-11-17', expiresAt: '2026-11-17' };
  assert.equal(employeeContractStatus(contract, new Date('2026-11-16T15:59:59Z')).key, 'upcoming');
  assert.equal(employeeContractStatus(contract, new Date('2026-11-16T16:00:00Z')).key, 'within_term');
  assert.equal(employeeContractStatus(contract, new Date('2026-11-17T15:59:59Z')).key, 'within_term');
  assert.equal(employeeContractStatus(contract, new Date('2026-11-17T16:00:00Z')).key, 'expired');
});

test('inactive records distinguish evidenced removal from unknown retained history', () => {
  assert.equal(employeeContractStatus({ isActive: false, recordState: 'removed' }, auditDay).label, '已删除');
  assert.equal(employeeContractStatus({ isActive: false, recordState: 'retained' }, auditDay).label, '历史保留记录');
  assert.equal(employeeContractStatus({ isActive: false, endedAt: '2026-11-17' }, auditDay).label, '历史保留记录');
});

test('overlapping dates flag every included contract without choosing a winner', () => {
  const rows = [
    { id: 'a', effectiveFrom: '2026-01-01', expiresAt: '2026-12-31' },
    { id: 'b', effectiveFrom: '2026-12-01', expiresAt: '2027-12-31' },
    { id: 'next', effectiveFrom: '2028-01-01', expiresAt: '2028-12-31' },
    { id: 'removed', effectiveFrom: '2026-01-01', termType: '无固定期限', isActive: false },
    { id: 'unknown', effectiveFrom: '2026-02-30', expiresAt: '2029-01-01' },
  ];
  assert.deepEqual([...overlappingContractIds(rows)].sort(), ['a', 'b']);
  assert.deepEqual([...overlappingContractIds([...rows].reverse())].sort(), ['a', 'b']);
  assert.equal(rows[0].expiresAt, '2026-12-31');
});

test('open-ended intervals overlap, consecutive terms do not, supporting agreements do not compete', () => {
  assert.deepEqual([...overlappingContractIds([
    { id: 'open', contractType: 'contract', effectiveFrom: '2026-01-01', termType: '无固定期限' },
    { id: 'new', contractType: 'renewal', effectiveFrom: '2027-01-01', expiresAt: '2028-12-31' },
  ])].sort(), ['new', 'open']);
  assert.equal(overlappingContractIds([
    { id: 'a', effectiveFrom: '2026-01-01', expiresAt: '2026-12-31' },
    { id: 'b', effectiveFrom: '2027-01-01', expiresAt: '2027-12-31' },
    { id: 'agreement', contractType: 'confidentiality', effectiveFrom: '2026-01-01', expiresAt: '2027-12-31' },
  ]).size, 0);
});

test('same-day records have a deterministic created-at and id order', () => {
  const input = [
    { id: 'a', signedAt: '2026-11-12', createdAt: '2026-11-12T02:00:00Z' },
    { id: 'b', signedAt: '2026-11-12T00:00:00Z', createdAt: '2026-11-12T02:00:00Z' },
    { id: 'c', signedAt: '2026-11-12', createdAt: '2026-11-12T03:00:00Z' },
  ];
  assert.deepEqual(sortContractsLatestFirst(input).map(item => item.id), ['c', 'b', 'a']);
  assert.deepEqual(sortContractsLatestFirst([...input].reverse()).map(item => item.id), ['c', 'b', 'a']);
});

test('presentation never mutates the stored order, record identity or active status', () => {
  const input = Object.freeze([
    Object.freeze({ id: 'old', signedAt: '2025-01-01', isActive: true, sequence: 1 }),
    Object.freeze({ id: 'new', signedAt: '2026-01-01', isActive: false, sequence: 2 }),
  ]);
  const sorted = sortContractsLatestFirst(input);
  assert.equal(sorted[0], input[1]);
  assert.equal(sorted[1], input[0]);
  assert.equal(sorted[0].isActive, false);
  assert.deepEqual(input.map(item => item.id), ['old', 'new']);
});

async function mountCompanySelect(t, input) {
  const vue = require('vue');
  const { parse, compileScript } = require('@vue/compiler-sfc');
  const filename = path.resolve(__dirname, '../src/components/common/ContractSubjectSelect.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const component = loadTs(filename, compileScript(descriptor, { id: 'company-select' }).content, {
    '@/api/contract-subjects.api': { contractSubjectsApi: { findAll: async () => [
      { id: 'active-subject', name: '现有签约公司', isActive: true },
      { id: 'inactive-subject', name: '停用签约公司', isActive: false },
    ] } },
    '@/stores/auth.store': { useAuthStore: () => ({ user: { sysRole: 'hr' } }) },
    '@/utils/business-permissions': { canMaintainContractSubjects: () => true },
  }).default;
  const renderer = vue.createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {},
    setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
  });
  const events = [];
  let state;
  const app = renderer.createApp({ setup() {
    state = component.setup(vue.reactive(input), { emit: (...args) => events.push(args), expose() {} });
    return () => null;
  } });
  const previousWindow = global.window;
  global.window = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { app.unmount(); global.window = previousWindow; });
  app.mount({});
  await vue.nextTick();
  return { state, events };
}

test('company-name fields choose an existing company without adding a subject ID', async t => {
  const { state, events } = await mountCompanySelect(t, { nameOnly: true, snapshotName: '历史公司原文' });
  state.select('现有签约公司');
  assert.deepEqual(events, [['update:snapshotName', '现有签约公司'], ['select', { id: 'active-subject', name: '现有签约公司', isActive: true }]]);
  state.select('');
  assert.deepEqual(events.slice(-2), [['update:snapshotName', null], ['select', null]]);
});

test('company-name selector preserves an inactive current company but cannot newly select it', async t => {
  const { state, events } = await mountCompanySelect(t, { nameOnly: true, snapshotName: '停用签约公司' });
  assert.equal(state.current.value.id, 'inactive-subject');
  assert.deepEqual(state.options.value.map(item => item.name), ['现有签约公司', '停用签约公司']);
  state.select('停用签约公司');
  assert.deepEqual(events, []);
});

test('signing-company selector still emits the subject ID and frozen name together', async t => {
  const { state, events } = await mountCompanySelect(t, { snapshotName: '历史公司原文' });
  state.select('active-subject');
  assert.deepEqual(events, [['update:modelValue', 'active-subject'], ['update:snapshotName', '现有签约公司'], ['select', { id: 'active-subject', name: '现有签约公司', isActive: true }]]);
});

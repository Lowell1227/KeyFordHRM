const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const flush = () => new Promise(resolve => setImmediate(resolve));
function load() {
  const filename = path.resolve(__dirname, '../src/views/compensation/payroll/payroll-recovery-form.ts');
  const m = new Module(filename, module);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
test('opening correction requires explicit money, evidence and reason without zero-fill', () => {
  const { openingCorrectionErrors } = load();
  assert.deepEqual(Object.keys(openingCorrectionErrors({ amount: '', reference: '', reason: '' })), ['amount', 'reference', 'reason']);
  assert.deepEqual(openingCorrectionErrors({ amount: '0', reference: 'checked', reason: 'entry typo' }), {});
  assert.ok(openingCorrectionErrors({ amount: '1.001', reference: 'checked', reason: 'entry typo' }).amount);
  assert.ok(openingCorrectionErrors({ amount: 'abc', reference: 'checked', reason: 'entry typo' }).amount);
});
test('opening audit display preserves unknown amounts and formats before / after changes', () => {
  const { openingAuditChanges } = load();
  assert.deepEqual(openingAuditChanges({ amount: null, reference: null }, { amount: '0.00', reference: 'verified' }), [
    { label: '历史已付金额', before: '待确认', after: '0.00' }, { label: '确认凭证', before: '待确认', after: 'verified' },
  ]);
});

function ledger(t, overrides = {}) {
  const filename = path.resolve(__dirname, '../src/views/compensation/payroll/PayrollLedger.vue');
  const script = compileScript(parse(fs.readFileSync(filename, 'utf8')).descriptor, { id: 'ledger-recovery' }).content;
  const writes = [], reads = [], events = [];
  const history = { openingId: 'opening', subjectId: 'subject', employeeId: 'employee', month: '2037-01', itemCode: 'base',
    currentHash: 'a'.repeat(64), current: { amount: '125.00', reference: 'old evidence', confirmedAt: '2037-02-01' }, versions: [] };
  const m = new Module(filename, module); m.paths = module.paths;
  m.require = id => {
    if (id === 'vue') return vue;
    if (id === './payroll-recovery-form') return load();
    if (id === './payroll-state') return { itemLabels: { base: '固定工资' }, isDecimal: value => /^-?\d+(\.\d{1,2})?$/.test(value) };
    if (id === '@/api/payroll.api') return { payrollError: async error => error.message, payrollApi: { openings: async () => [], adjustments: async () => [] } };
    if (id === '@/api/payroll-recovery.api') return { payrollRecoveryApi: {
      openingHistory: async id => { reads.push(id); return overrides.read ? overrides.read(id) : history; },
      correctOpening: async (id, body) => { writes.push({ id, ...body }); if (overrides.write) return overrides.write(id, body); return {}; },
    } };
    return require(id);
  };
  m._compile(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  const scope = vue.effectScope(); t.after(() => scope.stop());
  const props = vue.reactive({ subjectId: 'subject', month: '2037-01', kind: 'opening', employees: [] });
  const vm = scope.run(() => m.exports.default.setup(props, { expose() {}, emit: (...args) => events.push(args) }));
  return { vm, writes, reads, events, props, history };
}
test('ledger opens explicit current-version correction, validates local fields and retains request identity after network failure', async t => {
  const s = ledger(t, { write: () => { throw new Error('network unavailable'); } });
  await s.vm.showOpeningHistory('opening');
  assert.equal(s.vm.correction.amount, '125.00');
  await s.vm.correctOpening(); assert.match(s.vm.correctionFields.value.reason, /原因/); assert.equal(s.writes.length, 0);
  s.vm.correction.amount = '120.00'; s.vm.correction.reason = 'Fix fictional typo';
  await s.vm.correctOpening(); await s.vm.correctOpening();
  assert.equal(s.writes.length, 2); assert.equal(s.writes[0].requestId, s.writes[1].requestId);
  assert.equal(s.writes[0].expectedHash, 'a'.repeat(64)); assert.equal(s.vm.correction.amount, '120.00');
  s.vm.correction.reason = 'Different request'; await s.vm.correctOpening();
  assert.notEqual(s.writes[2].requestId, s.writes[0].requestId);
});
test('ledger discards history from a previous payer or month, keeping unknown money blank', async t => {
  let finish;
  const s = ledger(t, { read: () => new Promise(resolve => { finish = resolve; }) });
  const pending = s.vm.showOpeningHistory('opening');
  s.props.subjectId = 'other-subject'; s.props.month = '2037-02'; await flush();
  finish(s.history); await pending;
  assert.equal(s.vm.history.value, null); assert.equal(s.vm.historyVisible.value, false);
  const unknown = ledger(t); unknown.history.current.amount = null; unknown.history.current.reference = null;
  await unknown.vm.showOpeningHistory('opening'); assert.equal(unknown.vm.correction.amount, '');
});
test('successful correction refreshes auditable history and notifies the parent to recalculate', async t => {
  const s = ledger(t); await s.vm.showOpeningHistory('opening');
  s.vm.correction.amount = '120.00'; s.vm.correction.reason = 'Fix fictional typo';
  await s.vm.correctOpening();
  assert.equal(s.writes.length, 1); assert.equal(s.reads.length, 2);
  assert.ok(s.events.some(event => event[0] === 'changed')); assert.equal(s.vm.busy.value, false);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/views/compensation/payroll/payroll-state.ts');
function load() { assert.ok(fs.existsSync(filename), 'payroll state module must exist'); const m = new Module(filename, module); m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename); return m.exports; }
test('actions bind approval actor, version, subject, stale source, and trial export', () => {
  const { batchActions } = load();
  const batch = { subjectId: 'a', status: 'pending', purpose: 'validation', version: 7, versions: [{ version: 2, approvalPath: ['r', 'p'], reviewerCount: 1, approvalStep: 0, status: 'pending' }] };
  const caps = ['payroll_edit', 'payroll_review', 'payroll_approve', 'payroll_export', 'payroll_settle'];
  assert.ok(batchActions(batch, caps, 'r').includes('approve'));
  assert.ok(!batchActions(batch, caps, 'p').includes('approve'));
  assert.ok(!batchActions({ ...batch, needsUpdate: true }, caps, 'r').includes('approve'));
  assert.ok(batchActions({ ...batch, needsUpdate: true }, caps, 'r').includes('return'));
  const approved = { ...batch, status: 'approved', versions: [{ ...batch.versions[0], status: 'approved' }] };
  assert.ok(batchActions(approved, caps, 'r').includes('export'));
  assert.ok(!batchActions({ ...approved, purpose: 'trial' }, caps, 'r').includes('export'));
  assert.deepEqual(batchActions(approved, ['attendance_edit'], 'r'), []);
});
test('calculation version differs from batch optimistic token; pending role follows approval step', () => {
  const { currentVersion, batchActions, batchStatus } = load();
  const b = { status: 'pending', version: 8, versions: [{ version: 2, status: 'pending', approvalPath: ['r','p'], reviewerCount: 1, approvalStep: 1 }, { version: 1, status: 'returned' }] };
  assert.equal(currentVersion(b).version, 2);
  assert.equal(batchStatus(b), '待审批');
  assert.ok(batchActions(b, ['payroll_approve'], 'p').includes('approve'));
  assert.ok(!batchActions(b, ['payroll_review'], 'p').includes('approve'));
});
test('subject capability never leaks from a different subject or disabled switch', () => {
  const { subjectCapabilities } = load();
  const access = { enabled: true, subjects: [{ id: 'a', capabilities: ['attendance_edit'] }, { id: 'b', capabilities: ['payroll_edit'] }] };
  assert.deepEqual(subjectCapabilities(access, 'a'), ['attendance_edit']);
  assert.deepEqual(subjectCapabilities({ ...access, enabled: false }, 'b'), []);
  assert.deepEqual(subjectCapabilities(access, 'missing'), []);
});
test('freshness on latest version blocks approval and trial/incomplete batches do not submit', () => {
  const { batchActions } = load();
  const b = { status: 'pending', purpose: 'validation', version: 9, versions: [{ version: 2, status: 'pending', needsUpdate: true, approvalPath: ['r'], approvalStep: 0, reviewerCount: 1 }] };
  assert.ok(!batchActions(b, ['payroll_review'], 'r').includes('approve'));
  const trial = { ...b, purpose: 'trial', status: 'calculated' };
  assert.ok(!batchActions(trial, ['payroll_edit'], 'r').includes('submit'));
  const missing = { ...trial, purpose: 'validation', versions: [{ ...b.versions[0], status: 'calculated', needsUpdate: false, gross: null, issues: ['待配置'], lines: [] }] };
  assert.ok(!batchActions(missing, ['payroll_edit'], 'r').includes('submit'));
});
test('submitted-by self cannot decide and cancelled payment arrangements do not export again', () => {
  const { batchActions } = load();
  const b = { status: 'pending', purpose: 'validation', version: 5, versions: [{ version: 1, status: 'pending', approvalPath: ['r'], approvalStep: 0, reviewerCount: 1, submittedById: 'r' }] };
  assert.ok(!batchActions(b, ['payroll_review'], 'r').includes('approve'));
  const cancelled = { ...b, status: 'approved', versions: [{ ...b.versions[0], status: 'approved' }], events: [{ action: 'remainder_cancelled', version: 1 }] };
  assert.ok(!batchActions(cancelled, ['payroll_export'], 'r').includes('export'));
});

test('void requires settlement authority, not only payroll editing', () => {
  const { batchActions } = load();
  const batch = { status: 'approved', purpose: 'validation', versions: [{ status: 'approved', version: 1, approvalPath: [], approvalStep: 0 }] };
  assert.ok(!batchActions(batch, ['payroll_edit'], 'operator').includes('void'));
  assert.ok(batchActions(batch, ['payroll_settle'], 'finance').includes('void'));
});

test('default payroll month follows Beijing business time across month boundary', () => {
  const { payrollBusinessMonth } = load();
  assert.equal(payrollBusinessMonth(new Date('2026-10-31T16:01:00Z')), '2026-11');
  assert.equal(payrollBusinessMonth(new Date('2026-10-31T15:59:00Z')), '2026-10');
});

test('a held partially paid version permits stopping the remaining arrangement but not new money or export', () => {
  const { batchActions } = load();
  const version = { version: 1, status: 'approved', approvalPath: ['r', 'p'], reviewerCount: 1, approvalStep: 2,
    lines: [{ status: 'ready', amount: '200.00', reservation: { lineId: 'line' }, settlements: [{ amount: '150.00' }] }] };
  const batch = { status: 'approved', purpose: 'validation', needsUpdate: true, versions: [version] };
  const actions = batchActions(batch, ['payroll_settle', 'payroll_export'], 'finance');
  assert.ok(actions.includes('cancel-remainder'));
  assert.ok(!actions.includes('settle'));
  assert.ok(!actions.includes('export'));
  assert.ok(!batchActions(batch, ['payroll_view'], 'reader').includes('cancel-remainder'));
  assert.ok(!batchActions({ ...batch, purpose: 'trial' }, ['payroll_settle'], 'finance').includes('cancel-remainder'));
  assert.ok(!batchActions({ ...batch, versions: [{ ...version, lines: [{ ...version.lines[0], reservation: null }] }] }, ['payroll_settle'], 'finance').includes('cancel-remainder'));
});

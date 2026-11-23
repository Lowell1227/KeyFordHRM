const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/views/system/payroll-grants-form.ts');
const m = new Module(file, module);
m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, file);
const { grantDraftErrors } = m.exports;
const capabilities = ['attendance_edit', 'payroll_view'];
const valid = { subjectId: 'subject', userId: 'person', capabilities: ['payroll_view'], reason: '已批准的独立授权依据', expectedUpdatedAt: null };

test('empty grant reports errors beside each required field', () => {
  const errors = grantDraftErrors({ ...valid, subjectId: '', userId: '', capabilities: [], reason: ' ' }, capabilities);
  assert.deepEqual(Object.keys(errors).sort(), ['capabilities', 'reason', 'subjectId', 'userId']);
});
test('unknown, derived and repeated capabilities are rejected rather than filtered out', () => {
  for (const values of [['payroll_parameter_review'], ['payroll_view', 'payroll_view'], ['unknown']])
    assert.ok(grantDraftErrors({ ...valid, capabilities: values }, capabilities).capabilities);
});
test('valid explicit permission is accepted and never mutates the selected version', () => {
  const input = { ...valid, expectedUpdatedAt: '2037-01-01T00:00:00.000Z' };
  const before = JSON.stringify(input);
  assert.deepEqual(grantDraftErrors(input, capabilities), {});
  assert.equal(JSON.stringify(input), before);
});
test('oversize evidence is rejected', () => {
  assert.ok(grantDraftErrors({ ...valid, reason: 'x'.repeat(501) }, capabilities).reason);
});

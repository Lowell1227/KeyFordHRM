const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/views/compensation/payroll/payroll-attendance-mappings.ts'), m = new Module(file, module);
m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, file);
const { attendanceMappingPayload } = m.exports;
test('attendance classification remains explicit and does not insert a default', () => {
  assert.deepEqual(attendanceMappingPayload([]), { value: {}, errors: {} });
  const row = { key: '1:年假:年假', type: 'paid_leave', overtimeKind: '' };
  assert.deepEqual(attendanceMappingPayload([row]).value, { '1:年假:年假': { type: 'paid_leave' } });
  assert.equal(row.overtimeKind, '');
});
test('duplicates and missing overtime day kind are field errors, not silent overwrites', () => {
  const duplicate = { key: '1:年假:年假', type: 'paid_leave', overtimeKind: '' };
  assert.ok(attendanceMappingPayload([duplicate, duplicate]).errors['1.key']);
  assert.ok(attendanceMappingPayload([{ key: '3:加班:加班', type: 'overtime', overtimeKind: '' }]).errors['0.overtimeKind']);
  assert.ok(attendanceMappingPayload([{ key: 'bad', type: 'paid_leave', overtimeKind: '' }]).errors['0.key']);
  assert.ok(attendanceMappingPayload([{ key: '1:年假:年假', type: 'normal', overtimeKind: '' }]).errors['0.type']);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/views/compensation/payroll/payroll-employee-scope-form.ts');
const m = new Module(file, module);
m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, file);
const { employeeScopeErrors } = m.exports;
const available = ['a', 'b'];
test('formal scope requires an explicit nonempty selection and evidence', () => {
  assert.deepEqual(Object.keys(employeeScopeErrors(undefined, available)).sort(), ['employeeIds', 'evidenceRef']);
  assert.deepEqual(Object.keys(employeeScopeErrors({ employeeIds: [], evidenceRef: ' ' }, available)).sort(), ['employeeIds', 'evidenceRef']);
});
test('duplicate, unavailable and oversize selections are not silently discarded', () => {
  for (const employeeIds of [['a', 'a'], ['c'], Array(1001).fill('a')])
    assert.ok(employeeScopeErrors({ employeeIds, evidenceRef: '已核对' }, available).employeeIds);
  assert.ok(employeeScopeErrors({ employeeIds: ['a'], evidenceRef: 'x'.repeat(201) }, available).evidenceRef);
});
test('explicit valid scope is accepted without changing the draft', () => {
  const scope = { employeeIds: ['b', 'a'], evidenceRef: '已核对的主体归属' }, before = JSON.stringify(scope);
  assert.deepEqual(employeeScopeErrors(scope, available), {});
  assert.equal(JSON.stringify(scope), before);
});

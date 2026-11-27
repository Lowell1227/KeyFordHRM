const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/utils/business-permissions.ts');
const loaded = new Module(file, module);
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);

for (const role of ['hr', 'system_admin']) test(`${role} retains only explicitly selected cycle termination when settings are saved`, () => {
  const normalize = loaded.exports.maintainedHrCapabilities;
  assert.equal(typeof normalize, 'function');
  assert.deepEqual(normalize(role, ['cycle_terminate', 'recruitment_demand_review', 'cycle_plan_edit']),
    ['cycle_terminate', 'recruitment_demand_review']);
  assert.deepEqual(normalize(role, ['recruitment_demand_review']), ['recruitment_demand_review']);
  assert.deepEqual(normalize(role, []), []);
});

test('ordinary HR keeps its selected granular abilities; non-HR roles cannot acquire cycle termination', () => {
  const normalize = loaded.exports.maintainedHrCapabilities;
  assert.equal(typeof normalize, 'function');
  const selected = ['cycle_terminate', 'employee_archive_edit'];
  assert.deepEqual(normalize('hr_user', selected), ['cycle_terminate', 'employee_archive_edit']);
  for (const role of ['employee', 'manager', 'vp']) assert.deepEqual(normalize(role, ['cycle_terminate', 'recruitment_view']), ['recruitment_view']);
  assert.deepEqual(selected, ['cycle_terminate', 'employee_archive_edit']);
});

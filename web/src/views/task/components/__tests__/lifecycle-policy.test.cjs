const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadApi(name) {
  const filename = path.resolve(__dirname, '../../../../../src/api', name);
  const loaded = new Module(filename, module);
  loaded.require = id => id === './http' ? { default: {} }
    : id === './performance-lifecycle.api' ? loadApi('performance-lifecycle.api.ts') : require(id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return loaded.exports;
}

test('original participant history is separate from global lifecycle metadata authority', () => {
  const api = loadApi('performance-lifecycle.api.ts');
  const employee = { id: 'fictional-employee', sysRole: 'employee' };
  assert.equal(api.canViewLifecycleHistory(employee), true);
  assert.equal(typeof api.canViewLifecycleLedger, 'function', 'global metadata read policy must be explicit');
  assert.equal(api.canViewLifecycleLedger(employee), false);
  assert.equal(api.canViewLifecycleLedger({ sysRole: 'hr' }), true);
  assert.equal(api.canViewLifecycleLedger({ sysRole: 'system_admin' }), true);
  assert.equal(api.canViewLifecycleLedger({ sysRole: 'hr_user', hrCapabilities: ['performance_lifecycle_view'] }), true);
  assert.equal(api.canViewLifecycleLedger({ sysRole: 'hr_user', hrCapabilities: ['performance_lifecycle_delete'] }), false);
  assert.equal(api.canViewLifecycleLedger({ sysRole: 'hr_user', isAssessorOnly: true, hrCapabilities: ['performance_lifecycle_view'] }), false);
});

test('goal monitor recognizes lifecycle-only HR staff and HR without a systemPermission field', () => {
  const { canMonitorGoals } = loadApi('goal-plans.api.ts');
  assert.equal(canMonitorGoals({ sysRole: 'hr' }), true);
  assert.equal(canMonitorGoals({ sysRole: 'hr_user', hrCapabilities: ['performance_lifecycle_view'] }), true);
  assert.equal(canMonitorGoals({ sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit', 'performance_publish'] }), true);
  assert.equal(canMonitorGoals({ sysRole: 'hr_user', hrCapabilities: [] }), false);
  assert.equal(canMonitorGoals({ sysRole: 'hr_user', isAssessorOnly: true, hrCapabilities: ['performance_lifecycle_view'] }), false);
});

test('metadata recheck preserves original business actions only while the record stays active', () => {
  const { applyLifecycleProjection } = loadApi('performance-lifecycle.api.ts');
  const row = { allowedActions: ['edit', 'submit', 'lifecycle_terminate'] };
  applyLifecycleProjection(row, { lifecycleStatus: 'active', lifecycleVersion: 2, allowedActions: ['lifecycle_terminate'] });
  assert.deepEqual(row.allowedActions, ['edit', 'submit', 'lifecycle_terminate']);
  applyLifecycleProjection(row, { lifecycleStatus: 'terminated', lifecycleVersion: 3, allowedActions: ['lifecycle_delete'] });
  assert.deepEqual(row.allowedActions, ['lifecycle_delete']);
});

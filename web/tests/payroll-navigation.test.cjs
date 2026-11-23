const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(file) {
  const filename = path.resolve(__dirname, '../src/router', file), m = new Module(filename, module);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
const { routes } = load('routes.ts');
const { canAccessRoute, buildNavigation, navigationTarget } = load('navigation.ts');
const actor = (capabilities = [], sysRole = 'employee', enabled = true) => ({ sysRole, canViewAll: true, payrollAccess: { enabled, subjects: [{ id: 'a', name: '虚构主体', capabilities }] } });
const payroll = () => routes.filter(r => r.path.startsWith('/payroll/'));
test('all seven payroll entries exist, with both guard metadata fields', () => {
  assert.deepEqual(payroll().map(route => route.path), [
    '/payroll/attendance', '/payroll/standards', '/payroll/deductions', '/payroll/parameter-reviews',
    '/payroll/batches', '/payroll/approvals', '/payroll/results',
  ]);
  for (const r of payroll()) { assert.equal(r.meta.payrollOnly, true); assert.ok(r.meta.payrollCapabilities.length); }
});
test('admin and HR have no implicit salary access; disabled and empty scopes fail closed', () => {
  for (const r of payroll()) for (const u of [actor([], 'system_admin'), actor([], 'hr'), actor(['payroll_edit'], 'hr', false)]) assert.equal(canAccessRoute(r, u), false);
});
test('attendance-only sees attendance, never salary routes, with unrelated menus unchanged', () => {
  const u = actor(['attendance_edit']);
  assert.deepEqual(payroll().filter(r => canAccessRoute(r, u)).map(r => r.path), ['/payroll/attendance']);
  const nav = buildNavigation(routes, u), comp = nav.find(n => n.key === 'compensation');
  assert.equal(comp.defaultPath, '/payroll/attendance'); assert.equal(comp.status, undefined);
  for (const key of ['performance', 'people', 'recruitment']) assert.deepEqual(nav.find(n => n.key === key), buildNavigation(routes, actor([])).find(n => n.key === key));
});
test('capability-specific pages and original admin planning fallback', () => {
  for (const cap of ['payroll_review', 'payroll_approve']) assert.deepEqual(payroll().filter(r => canAccessRoute(r, actor([cap]))).map(r => r.path), ['/payroll/approvals']);
  assert.deepEqual(payroll().filter(r => canAccessRoute(r, actor(['payroll_export']))).map(r => r.path), ['/payroll/results']);
  const planning = routes.find(r => r.path === '/compensation');
  assert.equal(canAccessRoute(planning, actor([], 'system_admin')), true);
  assert.equal(canAccessRoute(planning, actor(['attendance_seal'], 'system_admin')), false);
});

test('payroll menus describe actions in setup-to-result order and keep review roles separate', () => {
  const all = actor(['attendance_edit', 'attendance_seal', 'payroll_edit', 'payroll_review', 'payroll_approve', 'payroll_export', 'payroll_settle']);
  const group = buildNavigation(routes, all).find(row => row.key === 'compensation');
  assert.deepEqual(group.groups.flatMap(row => row.items.map(item => item.label)), ['工资资料', '扣缴资料', '资料审核', '考勤与封账', '试算与核算', '复核与审批', '结果与补差']);
  assert.equal(group.defaultPath, '/payroll/standards');
  for (const cap of ['payroll_review', 'payroll_approve']) assert.deepEqual(buildNavigation(routes, actor([cap])).find(row => row.key === 'compensation').groups.flatMap(row => row.items.map(item => item.label)), ['复核与审批']);
});

test('only payroll-to-payroll navigation carries the current company and valid business month', () => {
  const subjectId = '11111111-1111-4111-8111-111111111111';
  const from = { path: '/payroll/standards', query: { subjectId, month: '2026-10', tab: 'rules', readiness: 'list', releaseId: 'private' } };
  assert.deepEqual(navigationTarget('/payroll/attendance', from), { path: '/payroll/attendance', query: { subjectId, month: '2026-10' } });
  assert.equal(navigationTarget('/dashboard', from), '/dashboard');
  assert.equal(navigationTarget('/payroll/attendance', { ...from, path: '/dashboard' }), '/payroll/attendance');
  assert.deepEqual(navigationTarget('/payroll/batches', { ...from, query: { subjectId: 'bad', month: '2026-13' } }), { path: '/payroll/batches', query: {} });
});

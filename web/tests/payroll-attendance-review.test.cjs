const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function load() {
  const filename = path.resolve(__dirname, '../src/views/compensation/payroll/payroll-attendance-review.ts'), m = new Module(filename, module);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
test('attendance presentation shows meaningful states and never turns unconfirmed duration into zero', () => {
  const { attendanceRecordRows } = load();
  const source = [{ type: 'absence', resolution: 'usable', effectiveHours: '8', startsAt: '2026-11-02T01:00:00Z', endsAt: '2026-11-02T09:00:00Z' },
    { type: 'missing_punch', resolution: 'unresolved', effectiveHours: null, hours: '8' }];
  const before = JSON.stringify(source), rows = attendanceRecordRows(source);
  assert.equal(rows[0].typeLabel, '已核定缺勤'); assert.equal(rows[0].hours, '8'); assert.match(rows[0].range, /09:00/);
  assert.equal(rows[1].hours, '待核定'); assert.equal(rows[1].status, '待核对'); assert.equal(JSON.stringify(source), before);
});
test('day history keeps global notes but excludes other people and dates', () => {
  const { attendanceDayReviews, pendingAbsenceProposals } = load();
  const reviews = [
    { actorId: 'hr', at: '2026-11-03', note: 'month' },
    { kind: 'absence_proposed', id: 'p', actorId: 'hr', employeeId: 'a', workDate: '2026-11-02', reference: 'basis' },
    { kind: 'absence_proposed', id: 'other', actorId: 'hr', employeeId: 'b', workDate: '2026-11-02' },
    { kind: 'absence_proposed', id: 'later', actorId: 'hr', employeeId: 'a', workDate: '2026-11-03' },
  ];
  const day = { employeeId: 'a', workDate: '2026-11-02' };
  assert.deepEqual(attendanceDayReviews(reviews, day).map(row => row.note || row.reference), ['month', 'basis']);
  assert.deepEqual(pendingAbsenceProposals(reviews, [], day).map(row => row.id), ['p']);
  assert.equal(pendingAbsenceProposals([...reviews, { kind: 'absence_returned', proposalId: 'p', actorId: 'sealer' }], [], day).length, 0);
  assert.equal(pendingAbsenceProposals(reviews, [{ id: 'p' }], day).length, 0);
});

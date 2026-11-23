const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const json = value => JSON.parse(JSON.stringify(value));
const contexts = new Map();

async function prepare({ db, services, fixture: f, actor, publish, settings, days, attendance, scenario, hash }) {
  const scope = { subjectId: f.subjectId };
  f.scenario = scenario;
  contexts.set(f.subjectId, { services, actor, publish, days });
  f.frozen = await db.payrollVersion.findFirstOrThrow({ where: { batchId: f.batchId }, orderBy: { version: 'desc' } });
  f.frozenHash = hash(json(f.frozen));
  const opening = await db.payrollOpeningBalance.findFirstOrThrow({ where: { ...scope, employeeId: f.users.employee, itemCode: 'fixed' } });
  const extra = { openingId: opening.id, settings: json(settings), employeeName: `${f.prefix}_employee_fictional`, employee2Name: `${f.prefix}_employee2_fictional` };
  if (['copy', 'recovery', 'recovery-pending', 'recovery-paid'].includes(scenario)) {
    const id = randomUUID();
    f.employmentIds = [f.employmentId, id];
    await db.employmentRecord.create({ data: { id, userId: f.users.employee2, employeeNo: `${f.prefix}_employee2`, deptId: f.departmentId,
      contractSubjectId: f.subjectId, effectiveFrom: new Date(days[0]), effectiveTo: new Date(days.at(-1)), entryDate: new Date(days[0]),
      employeeStatus: 'active', changeType: 'initial', sourceType: 'payroll_usability_ui_fictional', createdById: f.users.hr } });
    const original = await db.payrollPolicy.findFirstOrThrow({ where: { ...scope, status: 'active' } });
    const config = json(original.config);
    config.employeeScope.employeeIds.push(f.users.employee2);
    config.normalHourly = '62.5'; config.paidHourly.absence = '0';
    config.performance[f.month].manualAmounts[f.users.employee2] = '12.34';
    const rule = await services.data.saveRule({ ...scope, effectiveFrom: days[0], effectiveTo: days.at(-1), config }, actor('hr'));
    await publish('rule', rule);
    extra.currentRuleId = rule.id;
    if (scenario !== 'copy') {
      f.oldAttendance = json(await db.payrollAttendanceSnapshot.findUniqueOrThrow({ where: { id: attendance.id } }));
      f.oldAttendanceHash = hash(f.oldAttendance);
    }
  }
  if (scenario === 'absence' || scenario === 'absence-evidence') {
    const { normalizeAttendance } = require('../../src/payroll/payroll-attendance-normalizer');
    const { payrollAttendanceHash } = require('../../src/payroll/payroll-attendance-integrity');
    const workDate = days[0], employeeId = f.users.employee;
    const payload = json(attendance.payload);
    const expected = payload.days.map(day => ({ employeeId: day.employeeId, workDate: day.workDate, required: day.required, units: day.units }));
    const normalized = normalizeAttendance({ month: f.month, expected, records: payload.days.flatMap(day => day.records).filter(row => row.workDate !== workDate) });
    f.rawDay = { employeeId, workDate, complete: true, restsKnown: true, rests: [], punches: [], approvals: [],
      schedule: ['OnDuty', 'OffDuty'].map((checkType, index) => ({ id: `${f.prefix}:plan:${index}`, classId: 'fictional-class', workDate, checkType,
        plannedAt: `${workDate}T${index ? '16' : '08'}:00:00+08:00`, isRest: false, approvalLinked: false })) };
    const candidate = require('../../src/payroll/payroll-dingtalk-attendance').payrollAbsenceCandidate(f.rawDay, { employeeId, workDate, required: true, units: '1' });
    assert.ok(candidate, 'Server-side fictional raw-day candidate must pass the real converter rules; not DingTalk proof');
    const next = { ...normalized, dingtalk: { schema: 1, provider: 'dingtalk', absenceCandidates: [candidate] }, sync: payload.sync };
    const row = await db.payrollAttendanceSnapshot.create({ data: { ...scope, domain: 'formal', month: f.month, version: attendance.version + 1,
      sourceKey: `${f.prefix}:fictional-schedule-evidence`, sourceHash: payrollAttendanceHash(next), payload: json(next), createdById: f.users.hr } });
    const original = await db.payrollPolicy.findFirstOrThrow({ where: { ...scope, status: 'active' } });
    const config = json(original.config); config.normalHourly = '62.5'; config.paidHourly.absence = '0';
    await publish('rule', await services.data.saveRule({ ...scope, effectiveFrom: days[0], effectiveTo: days.at(-1), config }, actor('hr')));
    f.absenceId = row.id; f.oldAttendance = json(row); f.oldAttendanceHash = hash(f.oldAttendance);
    extra.absenceId = row.id; extra.absenceVersion = row.version; extra.workDate = workDate;
  }
  // These are explicit persisted concurrency preconditions, not simulated service responses.
  if (scenario === 'recovery-pending') {
    await db.payrollBatch.update({ where: { id: f.batchId }, data: { status: 'pending' } });
    await db.payrollVersion.update({ where: { id: f.frozen.id }, data: { status: 'pending' } });
    f.frozen = await db.payrollVersion.findUniqueOrThrow({ where: { id: f.frozen.id } }); f.frozenHash = hash(json(f.frozen));
  }
  if (scenario === 'recovery-paid') {
    const line = await db.payrollLine.findFirstOrThrow({ where: { versionId: f.frozen.id, itemCode: 'fixed' } });
    await db.payrollSettlement.create({ data: { lineId: line.id, amount: '1', reference: `${f.prefix}:fictional-existing-payment`,
      requestId: randomUUID(), requestHash: hash(`${f.prefix}:payment`), confirmedById: f.users.approver } });
  }
  await db.systemConfig.update({ where: { key: f.key }, data: { value: json({ fictional: true, manifest: { ...f, frozen: undefined, oldAttendance: undefined } }) } });
  return extra;
}

async function inspect({ db, fixture: f, hash }) {
  assert.ok(f);
  const versions = await db.payrollVersion.findMany({ where: { batchId: f.batchId }, orderBy: { version: 'asc' } });
  const attendance = await db.payrollAttendanceSnapshot.findMany({ where: { subjectId: f.subjectId }, orderBy: { version: 'asc' } });
  const events = await db.payrollEvent.findMany({ where: { subjectId: f.subjectId }, orderBy: { createdAt: 'asc' } });
  const oldAttendance = f.oldAttendance && attendance.find(row => row.id === f.oldAttendance.id);
  return { frozenUnchanged: hash(json(versions.find(row => row.id === f.frozen.id))) === f.frozenHash,
    attendanceHistoryUnchanged: !f.oldAttendance || hash(json(oldAttendance)) === f.oldAttendanceHash,
    events: events.map(row => ({ action: row.action, actorId: row.actorId, metadata: row.metadata })),
    versions: versions.map(row => ({ id: row.id, version: row.version, status: row.status, issues: row.issues })),
    attendance: attendance.map(row => ({ id: row.id, version: row.version, status: row.status, sourceHash: row.sourceHash })),
    profiles: await db.payrollDeductionProfile.findMany({ where: { subjectId: f.subjectId }, orderBy: { version: 'asc' } }) };
}
async function advanceEvidence({ db, fixture: f }) {
  assert.equal(f.scenario, 'absence-evidence');
  const { payrollAttendanceHash } = require('../../src/payroll/payroll-attendance-integrity');
  const prior = await db.payrollAttendanceSnapshot.findUniqueOrThrow({ where: { id: f.absenceId } });
  const payload = json(prior.payload);
  payload.dingtalk.absenceCandidates[0].proofHash = 'a'.repeat(64);
  return db.payrollAttendanceSnapshot.create({ data: { subjectId: f.subjectId, domain: 'formal', month: f.month, version: prior.version + 1,
    sourceKey: `${f.prefix}:changed-fictional-source`, sourceHash: payrollAttendanceHash(payload), payload, review: prior.review, createdById: f.users.hr } });
}
async function scopeChange({ db, fixture: f, exclude = false }) {
  assert.ok(f); const { services, actor, publish, days } = contexts.get(f.subjectId);
  if (!exclude && !f.employmentIds) {
    const id = randomUUID(); f.employmentIds = [f.employmentId, id];
    await db.employmentRecord.create({ data: { id, userId: f.users.employee2, employeeNo: `${f.prefix}_employee2`, deptId: f.departmentId,
      contractSubjectId: f.subjectId, effectiveFrom: new Date(days[0]), effectiveTo: new Date(days.at(-1)), entryDate: new Date(days[0]),
      employeeStatus: 'active', changeType: 'initial', sourceType: 'payroll_usability_ui_fictional', createdById: f.users.hr } });
  }
  const original = await db.payrollPolicy.findFirstOrThrow({ where: { subjectId: f.subjectId, status: 'active' }, orderBy: { version: 'desc' } });
  const config = json(original.config);
  config.employeeScope.employeeIds = exclude ? [f.users.employee] : [f.users.employee, f.users.employee2];
  if (exclude) delete config.performance[f.month].manualAmounts[f.users.employee2];
  else config.performance[f.month].manualAmounts[f.users.employee2] = '12.34';
  const rule = await services.data.saveRule({ subjectId: f.subjectId, effectiveFrom: days[0], effectiveTo: days.at(-1), config }, actor('hr'));
  await publish('rule', rule);
  await db.systemConfig.update({ where: { key: f.key }, data: { value: json({ fictional: true, manifest: { ...f, frozen: undefined, oldAttendance: undefined } }) } });
  return { ruleId: rule.id, excluded: exclude };
}
async function resyncConfirmed({ db, fixture: f }) {
  assert.ok(f.rawDay); const { services, actor } = contexts.get(f.subjectId);
  const prior = await db.payrollAttendanceSnapshot.findFirstOrThrow({ where: { subjectId: f.subjectId, month: f.month }, orderBy: { version: 'desc' } });
  const { convertDingtalkAttendance, payrollAbsenceCandidate } = require('../../src/payroll/payroll-dingtalk-attendance');
  const expected = { employeeId: f.users.employee, workDate: f.rawDay.workDate, required: true, units: '1' };
  const scope = { employeeIds: [expected.employeeId], from: expected.workDate, to: expected.workDate };
  const result = convertDingtalkAttendance({ month: f.month, organizationKey: `${f.prefix}:fictional-no-external-request`, complete: true,
    scope, pending: [], days: [f.rawDay] }, { expected: [expected], observationVersion: prior.version + 1, previous: [],
    confirmedAbsences: prior.payload.confirmedAbsences, approvalMappings: {} });
  assert.equal(result.complete, true); assert.deepEqual(result.pending, []);
  const candidate = payrollAbsenceCandidate(f.rawDay, expected);
  return services.data.syncVerified({ subjectId: f.subjectId, month: f.month, sourceKey: `${f.prefix}:resync:${prior.version}`, input: result.input,
    scope, complete: true }, actor('hr'), async () => ({ schema: 1, provider: 'dingtalk', fictional: true, noExternalCalls: true, absenceCandidates: [candidate] }));
}
async function editorGrant({ db, fixture: f, restore }) {
  assert.ok(f); const { services, actor } = contexts.get(f.subjectId);
  const grant = await db.payrollGrant.findUniqueOrThrow({ where: { userId_subjectId: { subjectId: f.subjectId, userId: f.users.hr } } });
  if (!restore) return services.grants.revoke(grant.id, { expectedUpdatedAt: grant.updatedAt.toISOString(), reason: `${f.prefix}:fictional-concurrent-batch-revocation` }, actor('admin'));
  return services.grants.save({ subjectId: f.subjectId, userId: f.users.hr, capabilities: restore
    ? ['attendance_edit', 'payroll_view', 'payroll_edit', 'payroll_export'] : [], expectedUpdatedAt: grant.updatedAt.toISOString(),
    reason: `${f.prefix}:fictional-concurrent-batch-authorization` }, actor('admin'));
}
module.exports = { prepare, inspect, advanceEvidence, scopeChange, resyncConfirmed, editorGrant };

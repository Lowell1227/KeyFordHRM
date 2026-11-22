const { execFileSync } = require('node:child_process');

// This helper owns only its fictional marker; it never resets the shared preview.
const source = `
require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const db = new PrismaClient();
(async () => {
  const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
  if (identity.db !== 'hrm_preview' || identity.role !== 'hrm_preview') throw new Error('Wrong database');
  if (!await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Missing preview marker');
  if (process.env.PAYROLL_ENABLED !== 'true' || process.env.PAYROLL_FORMAL_ENABLED === 'true') throw new Error('Wrong payroll mode');
  const key = 'payroll_preview_fixture_v1';
  const existing = await db.systemConfig.findUnique({ where: { key } });
  if (existing) {
    if (existing.value.fictional !== true) throw new Error('Unexpected ownership marker');
    return { prepared: true, preserved: true };
  }
  const actors = {};
  for (const employeeNo of ['ADMIN', 'HR001', 'MGR001', 'VP001', 'EMP001', 'EMP002', 'EMP003']) {
    const user = await db.user.findUniqueOrThrow({ where: { employeeNo } });
    if (!user.name.startsWith('测试') || user.deletedAt || user.archivedAt || user.dingtalkId || user.dingtalkUnionId || user.status !== 'active') throw new Error('Unexpected preview identity');
    actors[employeeNo] = user.id;
  }
  return db.$transaction(async tx => {
    const subjects = [];
    for (const name of ['薪酬隔离甲公司（虚构）', '薪酬隔离乙公司（虚构）']) {
      if (await tx.contractSubject.findUnique({ where: { name } })) throw new Error('Unowned fixture exists');
      subjects.push(await tx.contractSubject.create({ data: { name } }));
    }
    const dept = await tx.department.create({ data: { name: '薪酬验收专用（虚构）', leaderId: actors.MGR001, approverId: actors.VP001 } });
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    const start = new Date('2026-01-01T00:00:00Z');
    for (const [index, id] of ids.entries()) {
      const employeeNo = 'PAY-DEMO-' + String(index + 1);
      await tx.user.create({ data: { id, name: ['薪酬样例甲（虚构）', '薪酬样例乙（虚构）', '薪酬样例丙（虚构）'][index],
        employeeNo, deptId: dept.id, entryDate: start, directManagerId: actors.MGR001 } });
      await tx.employmentRecord.create({ data: { userId: id, employeeNo, effectiveFrom: start, entryDate: start,
        contractSubjectId: subjects[index === 2 ? 1 : 0].id, deptId: dept.id, directManagerId: actors.MGR001,
        employeeStatus: 'active', changeType: 'initial', sourceType: 'payroll_preview', createdById: actors.HR001 } });
    }
    const cycle = await tx.assessmentCycle.create({ data: { name: '薪酬个人结果验收（虚构）', type: 'quarterly',
      startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-11-30T00:00:00Z'), status: 'self_eval',
      workflowVersion: 2, goalWorkflowVersion: 2, createdBy: actors.HR001, hrOwnerId: actors.HR001, notificationMode: 'off' } });
    const publishedAt = new Date();
    const task = await tx.assessmentTask.create({ data: { cycleId: cycle.id, employeeId: ids[1], deptId: dept.id,
      managerId: actors.MGR001, deptHeadId: actors.MGR001, approverId: actors.VP001, status: 'published', publishedAt } });
    await tx.gradeResult.create({ data: { taskId: task.id, rawGrade: 'B', calibratedGrade: 'A', isPublished: true, publishedAt,
      hrCalibratorId: actors.HR001, hrCalibratedAt: publishedAt, approverId: actors.VP001, approvedAt: publishedAt } });
    for (const [index, id] of ids.entries()) {
      const subjectId = subjects[index === 2 ? 1 : 0].id;
      await tx.payrollStandard.create({ data: { subjectId, employeeId: id, domain: 'validation', version: 1, status: 'active',
        effectiveFrom: start, fixedMonthly: ['17400', '10000', '3000'][index], performanceBase: index === 1 ? '2000' : '0',
        performanceMode: index === 1 ? 'included' : 'none', evidence: '虚构验收参数，非正式工资标准', createdById: actors.HR001, activatedAt: publishedAt } });
      for (const month of ['2026-09', '2026-10', '2026-11']) for (const itemCode of ['fixed', 'absence', 'overtime', 'performance', 'adjustment']) {
        await tx.payrollOpeningBalance.create({ data: { subjectId, employeeId: id, domain: 'validation', attributionMonth: month,
          itemCode, amount: '0', reference: '虚构财务确认：该归属项无历史入薪', confirmedById: actors.VP001, confirmedAt: publishedAt } });
      }
    }
    const performance = Object.fromEntries(['2026-09', '2026-10', '2026-11'].map(month => [month,
      { cycleIds: [cycle.id], sourceKind: 'fictional', coefficients: { A: '1.2', B: '1', C: '0.8', D: '0.6' } }]));
    for (const subject of subjects) {
      await tx.payrollPolicy.create({ data: { subjectId: subject.id, domain: 'validation', version: 1, status: 'active',
        effectiveFrom: start, config: { rounding: 'item_half_up', monthlyUnits: { '2026-09': '20', '2026-10': '20', '2026-11': '20' },
          normalHourly: '100', paidHourly: { unpaid_leave: '0', sick_leave: null, absence: '0' },
          overtime: { hourlyBase: '100', weekday: '1.5', restday: '2', holiday: '3' }, reviewers: [actors.MGR001],
          approvers: [actors.VP001], cutoverMonth: '2026-09', performance }, createdById: actors.HR001, activatedAt: publishedAt } });
    }
    const grants = [
      [actors.HR001, subjects[0].id, ['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit']],
      [actors.MGR001, subjects[0].id, ['payroll_review']],
      [actors.VP001, subjects[0].id, ['payroll_approve', 'payroll_export', 'payroll_settle']],
      [actors.EMP002, subjects[0].id, ['attendance_edit', 'attendance_seal']],
      [actors.EMP003, subjects[1].id, ['payroll_view', 'payroll_edit']],
    ];
    for (const [userId, subjectId, capabilities] of grants) await tx.payrollGrant.create({ data: { userId, subjectId, capabilities, grantedById: actors.ADMIN } });
    await tx.systemConfig.create({ data: { key, value: { fictional: true, dataVersion: 1, subjectIds: subjects.map(row => row.id),
      employeeIds: ids, cycleIds: [cycle.id], actors, month: '2026-11' } } });
    return { prepared: true, subjects: subjects.length, employees: ids.length, independentActors: 5 };
  }, { timeout: 20000 });
})().then(result => process.stdout.write(JSON.stringify(result)))
  .finally(() => db.$disconnect()).catch(error => {
    process.stderr.write('Payroll preview fixture refused: ' + (error.code || 'preparation_failed'));
    process.exitCode = 1;
  });
`;
try {
  const result = JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000,
  }));
  console.log(JSON.stringify(result));
} catch {
  console.error('Payroll preview fixture refused or failed; no configuration or credentials logged.');
  process.exitCode = 1;
}

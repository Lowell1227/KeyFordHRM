const { execFileSync } = require('node:child_process');
const demo = process.argv.includes('--demo');
const source = `
require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const db = new PrismaClient();
(async () => {
  const [target] = await db.$queryRawUnsafe('SELECT current_database() AS name, current_user AS role');
  if (target.name !== 'hrm_preview' || target.role !== 'hrm_preview'
    || !await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw Error('wrong-preview');
  const marker = 'lifecycle_preview_demo_20261126';
  const previous = ${demo} ? await db.systemConfig.findUnique({ where: { key: marker } }) : null;
  if (previous) return previous.value;
  const actors = {};
  for (const number of ['HR001', 'MGR001', 'VP001']) {
    const person = await db.user.findUniqueOrThrow({ where: { employeeNo: number } });
    if (!person.name.startsWith('测试') || person.status !== 'active' || person.deletedAt || person.archivedAt
      || person.dingtalkId || person.dingtalkUnionId) throw Error('unexpected-preview-actor');
    actors[number] = person.id;
  }
  const prefix = 'LC_' + randomUUID().replace(/-/g, '').slice(0, 10);
  return db.$transaction(async tx => {
    const department = await tx.department.create({ data: { name: prefix + ' 虚构部门', company: 'fuede',
      leaderId: actors.MGR001, approverId: actors.VP001 } });
    const employee = await tx.user.create({ data: { name: prefix + ' 虚构试用员工', employeeNo: prefix,
      status: 'probation', accountType: 'employee', sysRole: 'employee', deptId: department.id,
      directManagerId: actors.MGR001, entryDate: new Date('2026-11-01'), mustChangePassword: false } });
    const employment = await tx.employmentRecord.create({ data: { userId: employee.id, employeeNo: prefix,
      effectiveFrom: new Date('2026-11-01'), entryDate: new Date('2026-11-01'), company: 'fuede', deptId: department.id,
      employeeStatus: 'probation', directManagerId: actors.MGR001, changeType: 'onboarding', sourceType: 'preview_fixture' } });
    const cycles = [];
    for (const label of ['目标台账', '目标变更']) cycles.push(await tx.assessmentCycle.create({ data: {
      name: prefix + ' ' + label, type: 'monthly', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30'),
      status: 'indicator_setting', workflowVersion: 2, goalWorkflowVersion: 2, scoringFrequency: 'cycle',
      hrOwnerId: actors.HR001, createdBy: actors.HR001, notificationMode: 'off' } }));
    const tasks = [];
    for (const [index, cycle] of cycles.entries()) {
      const task = await tx.assessmentTask.create({ data: { employeeId: employee.id, cycleId: cycle.id,
        deptId: department.id, managerId: actors.MGR001, deptHeadId: actors.MGR001, approverId: actors.VP001,
        employmentRecordId: employment.id, status: index ? 'goal_confirmed' : 'indicator_reviewing',
        ...(index ? { goalApprovedAt: new Date(), indicatorConfirmedAt: new Date() } : {}) } });
      const instance = await tx.indicatorInstance.create({ data: { taskId: task.id, name: prefix + ' 虚构目标',
        indicatorType: 'kpi', targetValue: 10, weight: 1, dimensionName: '业务目标', dimensionWeight: 1, sortOrder: 0 } });
      tasks.push({ ...task, instance });
    }
    const goals = [{ sourceInstanceId: tasks[1].instance.id, name: prefix + ' 虚构目标', description: null,
      scoringStandard: null, targetValue: 10, targetValueText: null, unit: null, weight: 1, indicatorType: 'kpi',
      dimensionName: '业务目标', dimensionWeight: 1, sortOrder: 0 }];
    const baseline = await tx.indicatorVersion.create({ data: { taskId: tasks[1].id, version: 1, status: 'active',
      createdById: actors.HR001, effectiveFromPeriodKey: '2026-11', activatedAt: new Date(),
      items: { create: goals.map(({ sourceInstanceId, ...goal }) => ({ ...goal, sourceInstanceId })) } } });
    await tx.goalChangeGrant.create({ data: { taskId: tasks[1].id, grantedById: actors.HR001 } });
    const change = await tx.goalChangeRequest.create({ data: { taskId: tasks[1].id, creatorId: employee.id,
      status: 'indicator_reviewing', baselineVersionId: baseline.id, reason: '虚构测试变更', beforeGoals: goals, goals } });
    const improvement = await tx.improvementPlan.create({ data: { employeeId: employee.id, creatorId: actors.MGR001,
      employmentRecordId: employment.id, workflowVersion: 3, status: 'goal_employee_confirm',
      improvementNeed: '虚构改进事项', goals: [{ id: randomUUID(), name: prefix + ' 改进目标', description: '虚构目标', weight: 1 }] } });
    const confirmation = await tx.confirmationApplication.create({ data: { employeeId: employee.id,
      employmentRecordId: employment.id, managerId: actors.MGR001, companyApproverId: actors.VP001,
      createdBy: employee.id, workflowVersion: 2, submissionVersion: 1, status: 'submitted', summary: '虚构转正小结' } });
    const result = { fictional: true, prefix, employeeId: employee.id, employeeName: employee.name,
      employmentId: employment.id, cycleId: cycles[0].id, taskId: tasks[0].id, changeParentId: tasks[1].id,
      changeId: change.id, improvementId: improvement.id, confirmationId: confirmation.id };
    if (${demo}) await tx.systemConfig.create({ data: { key: marker, value: result } });
    return result;
  }, { timeout: 20000 });
})().then(value => process.stdout.write(JSON.stringify(value))).finally(() => db.$disconnect()).catch(error => {
  const field = /Unknown argument \x60([A-Za-z]+)\x60/.exec(error.message ?? '')?.[1];
  const column = /^[A-Za-z0-9_.]+$/.test(error.meta?.column ?? '') ? error.meta.column : undefined;
  console.error(JSON.stringify({ category: error.name, code: error.code, invalidField: field, column })); process.exitCode = 1;
});
`;
try {
  const output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', input: source, stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000,
  });
  process.stdout.write(JSON.stringify(JSON.parse(output)));
} catch (error) {
  const diagnostic = String(error.stderr ?? '').trim();
  if (/^\{"category":"[A-Za-z]+"(?:,[^\r\n]*)?\}$/.test(diagnostic)) console.error(diagnostic);
  console.error('Fictional lifecycle preparation refused or failed; private subprocess output withheld.');
  process.exitCode = 1;
}

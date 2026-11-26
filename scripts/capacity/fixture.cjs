const { PrismaClient } = require('/app/node_modules/@prisma/client');
const bcrypt = require('/app/node_modules/bcrypt');
const prisma = new PrismaClient({ log: [] });

async function main() {
  const runId = process.env.CAPACITY_RUN_ID;
  if (!/^CAP_[a-f0-9]{12}$/.test(runId || '') || !process.env.DATABASE_URL?.endsWith(`hrm_capacity_${runId.slice(4)}?connection_limit=8`)) throw new Error('fixture-target-refused');
  if (await prisma.user.count()) throw new Error('fixture-database-not-empty');
  const password = process.env.CAPACITY_PASSWORD;
  if (!password || password.length < 20) throw new Error('fixture-password-missing');
  const passwordHash = await bcrypt.hash(password, 10);
  const company = await prisma.contractSubject.create({ data: { name: `${runId} Synthetic Company`, internalCompany: 'fuede' } });
  const dept = await prisma.department.create({ data: { name: `${runId} Synthetic Department`, company: 'fuede' } });
  async function user(suffix, role = 'employee', managerId) {
    const employeeNo = `${runId.slice(4)}-${suffix}`;
    const person = await prisma.user.create({ data: { employeeNo, name: `Synthetic ${suffix}`, passwordHash, deptId: dept.id,
      accountType: 'employee', status: 'active', sysRole: role, entryDate: new Date('2020-01-01'), directManagerId: managerId || null,
      hrCapabilities: role === 'hr' ? [] : [] } });
    await prisma.employmentRecord.create({ data: { userId: person.id, effectiveFrom: new Date('2020-01-01'), entryDate: new Date('2020-01-01'),
      company: 'fuede', companyText: company.name, contractSubjectId: company.id, deptId: dept.id, employeeNo,
      employeeStatus: 'active', directManagerId: managerId || null, changeType: 'initial', sourceType: 'capacity-fixture' } });
    return { id: person.id, employeeNo, password };
  }
  const actors = {};
  for (const key of ['manager', 'head', 'leader', 'hr']) actors[key] = await user(key, key === 'hr' ? 'hr' : 'employee');
  await prisma.department.update({ where: { id: dept.id }, data: { leaderId: actors.head.id, approverId: actors.leader.id } });
  const cycle = await prisma.assessmentCycle.create({ data: { name: `${runId} Goals`, startDate: new Date('2026-01-01'), endDate: new Date('2099-12-31'),
    selfEvalOpenAt: new Date('2020-01-01'), status: 'indicator_setting', workflowVersion: 2, goalWorkflowVersion: 2, createdBy: actors.hr.id } });
  async function task(person, status = 'indicator_drafting') {
    const task = await prisma.assessmentTask.create({ data: { cycleId: cycle.id, employeeId: person.id, deptId: dept.id,
      managerId: actors.manager.id, deptHeadId: actors.head.id, approverId: actors.leader.id, status } });
    await prisma.indicatorInstance.create({ data: { taskId: task.id, name: 'Synthetic capacity goal', weight: 1, dimensionWeight: 1,
      targetValue: 10, indicatorType: 'kpi', visibilityScope: 'supervisors' } });
    await prisma.indicatorVersion.create({ data: { taskId: task.id, version: 1, effectiveFromPeriodKey: '2026-11' } });
    await prisma.assessmentPeriod.create({ data: { taskId: task.id, periodKey: '2026-11', periodType: 'month', sequence: 1,
      periodStart: new Date('2026-11-01'), periodEnd: new Date('2026-11-30'), selfEvalOpenAt: new Date('2020-01-01'),
      selfEvalDueAt: new Date('2099-12-01'), managerDueAt: new Date('2099-12-31'), managerId: actors.manager.id } });
    return task.id;
  }
  const participants = [];
  for (let index = 0; index < 100; index += 1) {
    const person = await user(`E${String(index + 1).padStart(3, '0')}`, 'employee', actors.manager.id);
    participants.push({ ...person, taskId: await task(person) });
  }
  const handoffPerson = await user('handoff', 'employee', actors.manager.id);
  const handoff = { ...handoffPerson, taskId: await task(handoffPerson, 'indicator_confirming') };
  console.log(JSON.stringify({ runId, participants, actors, handoff, cycleId: cycle.id, companyId: company.id }));
}
main().catch((error) => {
  const field = String(error.message).match(/Unknown argument `([A-Za-z0-9_]+)`/);
  console.error(JSON.stringify({ kind: 'fixture-failed', code: error.code || error.name, field: field?.[1] || null }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

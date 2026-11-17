const { execFileSync } = require('node:child_process');

// Only the existing local preview is eligible; this helper never reads production configuration.
const source = `
require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const prisma = new PrismaClient();
(async () => {
  const [db] = await prisma.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
  if (db.db !== 'hrm_preview' || db.role !== 'hrm_preview') throw new Error('Wrong database');
  if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Missing ownership marker');
  const key = 'performance_changes_demo_v1';
  const marker = await prisma.systemConfig.findUnique({ where: { key } });
  if (marker) return { prepared: true, preserved: true };
  const actors = {};
  for (const employeeNo of ['HR001', 'MGR001', 'VP001', 'EMP001']) {
    const user = await prisma.user.findUniqueOrThrow({ where: { employeeNo } });
    if (user.deletedAt || user.archivedAt || user.dingtalkId || user.dingtalkUnionId || user.status !== 'active'
      || !user.name.startsWith('测试')) throw new Error('Unexpected preview identity');
    actors[employeeNo] = user;
  }
  if (actors.EMP001.directManagerId !== actors.MGR001.id || !actors.EMP001.deptId) throw new Error('Preview reporting relationship changed');
  const department = await prisma.department.findUniqueOrThrow({ where: { id: actors.EMP001.deptId } });
  if (department.leaderId !== actors.MGR001.id || department.approverId !== actors.VP001.id) throw new Error('Preview approvers changed');
  const now = new Date();
  const business = new Date(now.getTime() + 8 * 3600000);
  const year = business.getUTCFullYear(), month = business.getUTCMonth();
  const date = (offset, day = 1) => new Date(Date.UTC(year, month + offset, day));
  const periodKey = offset => date(offset).toISOString().slice(0, 7);
  const result = await prisma.$transaction(async tx => {
    const cycle = await tx.assessmentCycle.create({ data: {
      name: '目标变更验收（虚构数据）', type: 'quarterly', startDate: date(-1), endDate: date(2, 0),
      status: 'self_eval', workflowVersion: 2, goalWorkflowVersion: 2, scoringFrequency: 'monthly',
      hrOwnerId: actors.HR001.id, createdBy: actors.HR001.id, notificationMode: 'off',
    } });
    const task = await tx.assessmentTask.create({ data: {
      cycleId: cycle.id, employeeId: actors.EMP001.id, deptId: department.id, managerId: actors.MGR001.id,
      deptHeadId: department.leaderId, approverId: department.approverId, status: 'goal_confirmed',
      goalApprovedAt: now, indicatorConfirmedAt: now,
    } });
    const version = await tx.indicatorVersion.create({ data: {
      taskId: task.id, version: 1, status: 'active', effectiveFromPeriodKey: periodKey(-1),
      reason: '隔离预览验收样例', createdById: actors.HR001.id, activatedAt: now,
    } });
    const items = [];
    for (const [index, name] of ['交付及时率（虚构）', '质量检查（虚构）'].entries()) {
      const fields = { name, description: '隔离预览样例，可修改或替换', scoringStandard: '按完成率评分',
        targetValue: 100, targetValueText: null, unit: '%', weight: .5, indicatorType: 'kpi',
        dimensionName: '业务目标', dimensionWeight: 1, sortOrder: index };
      const instance = await tx.indicatorInstance.create({ data: { ...fields, taskId: task.id } });
      items.push(await tx.indicatorVersionItem.create({ data: { ...fields, sourceInstanceId: instance.id, indicatorVersionId: version.id } }));
    }
    for (const offset of [-1, 0, 1]) {
      const completed = offset === -1;
      const period = await tx.assessmentPeriod.create({ data: {
        taskId: task.id, managerId: actors.MGR001.id, indicatorVersionId: version.id, periodKey: periodKey(offset),
        periodType: 'month', sequence: offset + 2, periodStart: date(offset), periodEnd: date(offset + 1, 0),
        selfEvalOpenAt: offset === 0 ? new Date(now.getTime() - 86400000) : date(offset),
        selfEvalDueAt: date(offset + 1, 5), managerDueAt: date(offset + 1, 10),
        status: completed ? 'completed' : offset === 0 ? 'self_eval' : 'unopened',
        ...(completed ? { employeeSubmittedAt: now, managerSubmittedAt: now, lockedAt: now,
          selfScoreTotal: 80, managerScoreTotal: 85, selfGrade: 'B', managerGrade: 'B' } : {}),
      } });
      if (completed) {
        for (const item of items) await tx.assessmentPeriodIndicatorReview.create({ data: {
          periodId: period.id, indicatorVersionItemId: item.id, selfScore: 80, managerScore: 85,
          employeeComment: '虚构已完成月份', managerComment: '虚构评价记录',
        } });
        await tx.assessmentPeriodReviewRevision.create({ data: {
          periodId: period.id, stage: 'employee', revision: 1, snapshot: { fictional: true },
          idempotencyKey: randomUUID(), createdById: actors.EMP001.id,
        } });
      }
    }
    await tx.systemConfig.create({ data: { key, value: { fictional: true, taskId: task.id, cycleId: cycle.id } } });
    return { cycleName: cycle.name, employeeName: actors.EMP001.name };
  }, { timeout: 20000 });
  return { prepared: true, ...result };
})().then(result => process.stdout.write(JSON.stringify(result)))
  .finally(() => prisma.$disconnect()).catch(error => {
    const safe = ['Wrong database', 'Missing ownership marker', 'Unexpected preview identity',
      'Preview reporting relationship changed', 'Preview approvers changed'];
    const validation = error.name === 'PrismaClientValidationError' ? error.message.trim().split(String.fromCharCode(10)).slice(-1)[0] : null;
    process.stdout.write(JSON.stringify({ error: safe.includes(error.message) ? error.message : error.code || validation || 'preparation_failed' }));
    process.exitCode = 1;
  });
`;
try {
  const result = JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000,
  }));
  console.log(JSON.stringify(result));
} catch (error) {
  try { const result = JSON.parse(error.stdout); if (typeof result.error === 'string') console.error(result.error); } catch {}
  console.error('Preview sample preparation refused or failed; no configuration or credentials logged.');
  process.exitCode = 1;
}

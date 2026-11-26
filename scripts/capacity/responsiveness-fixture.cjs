#!/usr/bin/env node
'use strict';

// Run ONLY inside the owned API container, after fixture.cjs. No cleanup or notifications.
// Parent merges stdout.responsiveness into its private manifest; no password is returned.
// Both UI handoffs are single-use. Existing participants, goals and handoff stay untouched.
const assert = require('node:assert/strict');

function check(condition, code) { if (!condition) throw new Error(code); }
function validateTarget(env) {
  check(/^CAP_[a-f0-9]{12}$/.test(env.CAPACITY_RUN_ID || ''), 'invalid-capacity-run-id');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('fixture-database-refused'); }
  check(url.protocol === 'postgresql:' && url.hostname === 'pg' && url.port === '5432'
    && url.username === 'postgres' && url.password && !url.hash
    && url.pathname === `/hrm_capacity_${env.CAPACITY_RUN_ID.slice(4)}`
    && url.search === '?connection_limit=8', 'fixture-database-refused');
  for (const key of ['DINGTALK_NOTIFICATION_ENABLED', 'DINGTALK_INTERVIEW_CALENDAR_ENABLED',
    'DINGTALK_BOT_STREAM_ENABLED', 'RECRUITMENT_MAIL_ENABLED', 'ENABLE_TEST_QUICK_LOGIN']) {
    check(env[key] === 'false', 'fixture-external-effects-not-disabled');
  }
  check(!env.DINGTALK_APP_KEY && !env.DINGTALK_APP_SECRET, 'fixture-platform-credentials-present');
  check(typeof env.CAPACITY_PASSWORD === 'string' && env.CAPACITY_PASSWORD.length >= 20, 'fixture-password-missing');
  return env.CAPACITY_RUN_ID;
}

async function main() {
  const runId = validateTarget(process.env);
  const { PrismaClient } = require('/app/node_modules/@prisma/client');
  const bcrypt = require('/app/node_modules/bcrypt');
  const prisma = new PrismaClient({ log: [] });
  try {
    const prefix = `${runId.slice(4)}-`;
    check(await prisma.user.count() >= 105, 'base-fixture-missing');
    check(await prisma.user.count({ where: { OR: [
      { NOT: { employeeNo: { startsWith: prefix } } },
      { employeeNo: null }, { NOT: { name: { startsWith: 'Synthetic ' } } },
    ] } }) === 0, 'fixture-contains-unowned-people');
    const actors = {};
    for (const role of ['manager', 'head', 'leader', 'hr']) {
      actors[role] = await prisma.user.findUnique({ where: { employeeNo: prefix + role } });
      check(actors[role]?.status === 'active' && !actors[role].archivedAt && !actors[role].deletedAt,
        'base-actor-missing-or-inactive');
    }
    check(await bcrypt.compare(process.env.CAPACITY_PASSWORD, actors.manager.passwordHash), 'base-password-mismatch');
    const company = await prisma.contractSubject.findUnique({ where: { name: `${runId} Synthetic Company` } });
    const dept = await prisma.department.findFirst({ where: { id: actors.manager.deptId, name: `${runId} Synthetic Department` } });
    check(company && dept && Object.values(actors).every(actor => actor.deptId === dept.id), 'base-organization-mismatch');
    check(!await prisma.user.count({ where: { employeeNo: { startsWith: prefix + 'rsp-' } } }), 'responsiveness-fixture-already-exists');

    const result = await prisma.$transaction(async tx => {
      const now = new Date();
      const start = new Date('2026-11-01'), end = new Date('2026-11-30');
      async function cycle(suffix, status) {
        return tx.assessmentCycle.create({ data: {
          name: `${runId} Response ${suffix}`, startDate: start, endDate: end,
          selfEvalOpenAt: new Date('2020-01-01'), status, workflowVersion: 2, goalWorkflowVersion: 2,
          scoringFrequency: 'monthly', createdBy: actors.hr.id, hrOwnerId: actors.hr.id, notificationMode: 'off',
        } });
      }
      async function person(suffix) {
        const employeeNo = prefix + 'rsp-' + suffix;
        check(employeeNo.length <= 30, 'fixture-employee-number-too-long');
        const user = await tx.user.create({ data: {
          employeeNo, name: `Synthetic response-${suffix}`, passwordHash: actors.manager.passwordHash,
          deptId: dept.id, accountType: 'employee', status: 'active', sysRole: 'employee',
          entryDate: new Date('2020-01-01'), directManagerId: actors.manager.id, hrCapabilities: [],
        } });
        await tx.employmentRecord.create({ data: {
          userId: user.id, employeeNo, effectiveFrom: new Date('2020-01-01'), entryDate: new Date('2020-01-01'),
          company: 'fuede', companyText: company.name, contractSubjectId: company.id, deptId: dept.id,
          employeeStatus: 'active', directManagerId: actors.manager.id, changeType: 'initial', sourceType: 'capacity-fixture',
        } });
        return user;
      }
      async function task(user, assessmentCycle, resultFixture = false) {
        const row = await tx.assessmentTask.create({ data: {
          cycleId: assessmentCycle.id, employeeId: user.id, deptId: dept.id,
          managerId: actors.manager.id, deptHeadId: actors.head.id, approverId: actors.leader.id,
          status: resultFixture ? 'hr_calibration' : 'indicator_confirming',
          ...(resultFixture ? { goalApprovedAt: now, indicatorConfirmedAt: now, managerScoredAt: now, deptReviewedAt: now } : {}),
        } });
        const instance = await tx.indicatorInstance.create({ data: {
          taskId: row.id, name: 'Synthetic responsiveness goal', weight: 1, dimensionWeight: 1,
          targetValue: 10, indicatorType: 'kpi', visibilityScope: 'supervisors',
        } });
        const version = await tx.indicatorVersion.create({ data: {
          taskId: row.id, version: 1, effectiveFromPeriodKey: '2026-11',
          status: resultFixture ? 'active' : 'draft', ...(resultFixture ? { activatedAt: now } : {}),
        } });
        const item = await tx.indicatorVersionItem.create({ data: {
          indicatorVersionId: version.id, sourceInstanceId: instance.id,
          name: instance.name, weight: 1, dimensionWeight: 1, targetValue: 10, indicatorType: 'kpi',
        } });
        const period = await tx.assessmentPeriod.create({ data: {
          taskId: row.id, periodKey: '2026-11', periodType: 'month', sequence: 1, periodStart: start, periodEnd: end,
          selfEvalOpenAt: new Date('2020-01-01'), selfEvalDueAt: new Date('2099-12-01'), managerDueAt: new Date('2099-12-31'),
          managerId: actors.manager.id, indicatorVersionId: version.id,
          ...(resultFixture ? { status: 'completed', lockedAt: now, employeeSubmittedAt: now, managerSubmittedAt: now,
            selfGrade: 'B', managerGrade: 'B', selfScoreTotal: 80, managerScoreTotal: 80 } : {}),
        } });
        if (resultFixture) {
          await tx.gradeResult.create({ data: { taskId: row.id, calculatedScore: 80, rawGrade: 'B' } });
          await tx.managerEvalSummary.create({ data: { taskId: row.id, strengths: 'Synthetic fixture only', submittedAt: now } });
          await tx.assessmentPeriodIndicatorReview.create({ data: {
            periodId: period.id, indicatorVersionItemId: item.id, selfScore: 80, managerScore: 80,
          } });
        }
        return { id: user.id, employeeNo: user.employeeNo, employeeName: user.name,
          taskId: row.id, cycleId: assessmentCycle.id, cycleName: assessmentCycle.name };
      }
      const goals = await cycle('Goals', 'indicator_setting');
      const handoffs = {}, approvals = {};
      for (const viewport of ['pc', 'mobile']) {
        handoffs[viewport] = await task(await person(`goal-${viewport}`), goals);
        const results = await cycle(`Results ${viewport}`, 'hr_calibration');
        approvals[viewport] = await task(await person(`result-${viewport}`), results, true);
      }
      return { schemaVersion: 1, handoffs, approvals };
    }, { timeout: 30000 });
    process.stdout.write(JSON.stringify({ runId, responsiveness: result }) + '\n');
  } finally { await prisma.$disconnect(); }
}

function selfTest() {
  const env = { CAPACITY_RUN_ID: 'CAP_012345abcdef',
    DATABASE_URL: 'postgresql://postgres:fictional@pg:5432/hrm_capacity_012345abcdef?connection_limit=8',
    CAPACITY_PASSWORD: 'fictional-self-test-only', DINGTALK_NOTIFICATION_ENABLED: 'false',
    DINGTALK_INTERVIEW_CALENDAR_ENABLED: 'false', DINGTALK_BOT_STREAM_ENABLED: 'false',
    RECRUITMENT_MAIL_ENABLED: 'false', ENABLE_TEST_QUICK_LOGIN: 'false' };
  assert.equal(validateTarget(env), env.CAPACITY_RUN_ID);
  for (const DATABASE_URL of [
    env.DATABASE_URL.replace('@pg:', '@localhost:'), env.DATABASE_URL.replace('012345abcdef?', '111111111111?'),
    env.DATABASE_URL.replace('/hrm_capacity_', '/hrm_'), env.DATABASE_URL + '&schema=public',
    env.DATABASE_URL.replace('postgresql:', 'https:'),
  ]) assert.throws(() => validateTarget({ ...env, DATABASE_URL }));
  assert.throws(() => validateTarget({ ...env, CAPACITY_RUN_ID: 'CAP_other' }));
  assert.throws(() => validateTarget({ ...env, DINGTALK_NOTIFICATION_ENABLED: 'true' }));
  assert.throws(() => validateTarget({ ...env, DINGTALK_APP_KEY: 'fictional' }));
  process.stdout.write('{"status":"self_test_passed"}\n');
}

module.exports = { validateTarget, main, selfTest };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') selfTest();
  else if (args.length) { process.stderr.write('responsiveness-fixture-invalid-arguments\n'); process.exitCode = 1; }
  else main().catch(() => { process.stderr.write('responsiveness-fixture-failed-sensitive-detail-omitted\n'); process.exitCode = 1; });
}

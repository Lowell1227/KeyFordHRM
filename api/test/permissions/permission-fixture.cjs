'use strict';

async function createFixture(db, demo = false) {
  require('../../prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const [target] = await db.$queryRaw`SELECT current_database() AS name, current_user AS role`;
  assert.equal(target.name, 'hrm_preview'); assert.equal(target.role, 'hrm_preview');
  const marker = await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
  assert.equal(marker?.value?.fictional, true);
  const key = 'permission_preview_20261127';
  const existing = demo && await db.systemConfig.findUnique({ where: { key } });
  if (existing) { assert.equal(existing.value.fictional, true); return existing.value; }
  const prefix = 'PF_' + randomUUID().replace(/-/g, '').slice(0, 8);
  return db.$transaction(async tx => {
    const actors = {};
    for (const [kind, capabilities] of Object.entries({
      owner: ['cycle_plan_edit', 'performance_publish'],
      reviewer: ['cycle_plan_review'], recruiter: ['recruitment_view', 'recruitment_edit'],
      reader: ['recruitment_view'], employee: [], manager: [], revoked: ['recruitment_view', 'recruitment_edit'],
    })) {
      const user = await tx.user.create({ data: { employeeNo: prefix + '_' + kind,
        name: prefix + ' 虚构' + kind, sysRole: capabilities.length ? 'hr_user' : 'employee',
        status: 'active', accountType: 'employee', canViewAll: false, isAssessorOnly: false,
        mustChangePassword: false, hrCapabilities: capabilities } });
      await tx.employmentRecord.create({ data: { userId: user.id, employeeNo: user.employeeNo,
        effectiveFrom: new Date('2026-11-01'), entryDate: new Date('2026-11-01'),
        employeeStatus: 'active', changeType: 'onboarding', sourceType: 'preview_fixture' } });
      actors[kind] = { id: user.id, employeeNo: user.employeeNo, name: user.name };
    }
    const department = await tx.department.create({ data: { name: prefix + ' 虚构独立部门', company: 'fuede',
      leaderId: actors.manager.id } });
    await tx.user.update({ where: { id: actors.employee.id }, data: { deptId: department.id, directManagerId: actors.manager.id } });
    const cycles = [];
    for (const owned of [true, false]) {
      const cycle = await tx.assessmentCycle.create({ data: { name: prefix + (owned ? ' 月度进度演练' : ' 无关周期'),
        type: 'monthly', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30'),
        status: 'self_eval', workflowVersion: 2, goalWorkflowVersion: 2, scoringFrequency: 'monthly',
        openedAt: new Date(), hrOwnerId: owned ? actors.owner.id : actors.manager.id,
        reviewerId: owned ? actors.reviewer.id : null, notificationMode: 'off' } });
      const task = await tx.assessmentTask.create({ data: { cycleId: cycle.id, employeeId: actors.employee.id,
        deptId: department.id, managerId: actors.manager.id, status: 'dept_review' } });
      const period = await tx.assessmentPeriod.create({ data: { taskId: task.id, periodKey: '2026-11',
        periodType: 'month', sequence: 1, periodStart: new Date('2026-11-01'), periodEnd: new Date('2026-11-30'),
        managerId: actors.manager.id, status: 'completed', selfEvalOpenAt: new Date('2026-11-01'),
        selfEvalDueAt: new Date('2026-11-20'), managerDueAt: new Date('2026-11-25'),
        employeeSubmittedAt: new Date('2026-11-19'), managerSubmittedAt: new Date('2026-11-23'),
        lockedAt: new Date('2026-11-23'), selfScoreTotal: 88, managerScoreTotal: 90, selfGrade: 'B', managerGrade: 'A' } });
      cycles.push({ id: cycle.id, taskId: task.id, periodId: period.id, name: cycle.name });
    }
    const candidate = await tx.talentCandidate.create({ data: { name: prefix + ' 虚构候选人', phone: 'fixture-' + prefix,
      sourceChannel: 'other', ownerId: actors.recruiter.id, createdById: actors.recruiter.id } });
    const application = await tx.talentApplication.create({ data: { candidateId: candidate.id,
      positionName: '虚构验证岗位', ownerId: actors.recruiter.id, createdById: actors.recruiter.id, stage: 'interviewing' } });
    const interview = await tx.talentInterview.create({ data: { candidateId: candidate.id, applicationId: application.id,
      candidateNameSnapshot: candidate.name, startsAt: new Date('2037-01-10T02:00:00Z'), endsAt: new Date('2037-01-10T03:00:00Z'),
      invitationText: '隔离虚构邀约，不发送通知', syncStatus: 'uncertain', calendarOrganizerUnionId: prefix + '_fictional',
      externalCalendarId: 'primary', createdById: actors.recruiter.id } });
    await tx.talentInterviewSync.create({ data: { interviewId: interview.id, version: 1,
      operation: 'upsert', status: 'uncertain', participantIds: [], externalCalendarId: 'primary',
      calendarOrganizerUnionId: interview.calendarOrganizerUnionId } });
    const result = { fictional: true, prefix, actors, cycles, candidateId: candidate.id, candidateName: candidate.name,
      applicationId: application.id, interviewId: interview.id };
    if (demo) await tx.systemConfig.create({ data: { key, value: result } });
    return result;
  });
}

module.exports = { createFixture };

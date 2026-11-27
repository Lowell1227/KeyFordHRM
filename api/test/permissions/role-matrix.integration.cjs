'use strict';

async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const { PrismaClient } = require('@prisma/client');
  const { JwtService } = require('@nestjs/jwt');
  const { createFixture } = require('./test/permissions/permission-fixture.cjs');
  const assert = require('node:assert/strict');
  const db = new PrismaClient({ log: [] });
  const failures = [], rows = []; let requests = 0;
  try {
    const f = await createFixture(db), task = f.cycles[0];
    // Expectations describe abilities and frozen relationships, never employee names.
    const profiles = [
      { key: 'employee', existing: 'employee', goal: true, full: true },
      { key: 'frozen_manager', existing: 'manager', goal: true, full: true },
      { key: 'frozen_department_reviewer', role: 'employee', frozen: 'deptHeadId', goal: true, full: true },
      { key: 'frozen_approver', role: 'employee', frozen: 'approverId', goal: true, full: true },
      { key: 'title_only_manager', role: 'manager' },
      { key: 'title_only_department_head', role: 'dept_head' },
      { key: 'title_only_vp', role: 'vp' },
      { key: 'hr_admin', role: 'hr', caps: ['cycle_delete', 'cycle_terminate', 'recruitment_demand_review', 'recruitment_view'],
        goal: true, full: true, monthly: 1, talent: true, calendar: true, manage: true },
      { key: 'system_admin', role: 'system_admin', canViewAll: true, goal: true, full: true, monthly: 1, talent: true, calendar: true, manage: true },
      { key: 'cycle_owner', caps: ['cycle_plan_edit', 'performance_publish', 'performance_lifecycle_terminate', 'performance_lifecycle_delete'],
        owns: true, goal: true, monthly: 1, manage: true, masked: true },
      { key: 'other_cycle_specialist', caps: ['cycle_plan_edit', 'performance_publish', 'performance_lifecycle_terminate', 'performance_lifecycle_delete'],
        goal: true, monthly: 0, manage: true },
      { key: 'owner_without_result_access', caps: ['cycle_plan_edit'], owns: true, monthly: 1, masked: true },
      { key: 'assigned_cycle_reviewer', caps: ['cycle_plan_review'], reviews: true, monthly: 1, masked: true },
      { key: 'unassigned_cycle_reviewer', caps: ['cycle_plan_review'], monthly: 0 },
      { key: 'lifecycle_capability_without_scope', caps: ['performance_lifecycle_terminate', 'performance_lifecycle_delete'] },
      { key: 'lifecycle_reader', caps: ['performance_lifecycle_view'], goal: true, full: true },
      { key: 'hr_recruiter', caps: ['recruitment_edit'], talent: true, calendar: true },
      { key: 'employee_recruiter', role: 'employee', caps: ['recruitment_edit', 'recruitment_view'], talent: true, calendar: true },
      { key: 'archive_editor', caps: ['employee_archive_edit'], talent: true, calendar: true },
      { key: 'archive_reviewer', caps: ['employee_archive_review'], talent: true },
      { key: 'recruitment_reader', caps: ['recruitment_view'], talent: true },
      { key: 'hiring_confirmer_only', caps: ['talent_hiring_confirm'] },
      { key: 'plain_hr_user' },
      { key: 'current_personnel_recruitment_operator', caps: ['employee_archive_edit', 'organization_edit', 'recruitment_edit', 'recruitment_view'],
        talent: true, calendar: true },
      { key: 'current_performance_recruitment_operator', caps: ['confirmation_manage', 'cycle_delete', 'cycle_plan_edit', 'cycle_plan_review',
        'cycle_terminate', 'performance_calibration', 'performance_lifecycle_delete', 'performance_lifecycle_terminate', 'performance_publish',
        'recruitment_edit', 'recruitment_view'], owns: true, goal: true, monthly: 1, manage: true, masked: true, talent: true, calendar: true },
      { key: 'revoked_with_stale_token', staleClaims: true },
      { key: 'mixed_assessor_only', assessor: true, caps: ['cycle_plan_edit', 'performance_publish', 'recruitment_edit',
        'employee_archive_edit', 'performance_lifecycle_terminate', 'performance_lifecycle_delete'] },
      { key: 'archived_operator', disabled: 'archived', caps: ['recruitment_edit'] },
      { key: 'deleted_operator', disabled: 'deleted', caps: ['recruitment_edit'] },
      { key: 'resigned_operator', disabled: 'resigned', caps: ['recruitment_edit'] },
    ];
    for (const p of profiles) {
      p.user = p.existing ? await db.user.findUniqueOrThrow({ where: { id: f.actors[p.existing].id } })
        : await db.user.create({ data: { employeeNo: `${f.prefix}_${profiles.indexOf(p)}`, name: `${f.prefix} 虚构角色${profiles.indexOf(p)}`,
          sysRole: p.role || 'hr_user', accountType: 'employee', status: 'active', mustChangePassword: false,
          canViewAll: Boolean(p.canViewAll), isAssessorOnly: Boolean(p.assessor), hrCapabilities: p.caps || [] } });
      if (!p.existing) await db.employmentRecord.create({ data: { userId: p.user.id, employeeNo: p.user.employeeNo,
        effectiveFrom: new Date('2026-11-01'), entryDate: new Date('2026-11-01'), employeeStatus: 'active',
        changeType: 'onboarding', sourceType: 'preview_fixture' } });
      if (p.disabled) {
        await db.user.update({ where: { id: p.user.id }, data: p.disabled === 'resigned' ? { status: 'resigned' }
          : { [p.disabled === 'archived' ? 'archivedAt' : 'deletedAt']: new Date() } });
        if (p.disabled === 'resigned') await db.employmentRecord.updateMany({ where: { userId: p.user.id }, data: { employeeStatus: 'resigned' } });
      }
      if (p.frozen) await db.assessmentTask.update({ where: { id: task.taskId }, data: { [p.frozen]: p.user.id } });
    }
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const http = async (p, endpoint, body) => {
      const token = jwt.sign({ sub: p.user.id, employeeNo: p.user.employeeNo, ...(p.staleClaims ? {
        sysRole: 'hr', hrCapabilities: ['employee_archive_edit', 'cycle_plan_edit'], canViewAll: true } : {}) }, { expiresIn: '5m' });
      const response = await fetch('http://127.0.0.1:3000/api/v1' + endpoint, { method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      requests++; const envelope = await response.json(); return { status: response.status, data: envelope.data };
    };
    const check = (p, action, actual, expected) => {
      if (actual !== expected) failures.push({ role: p.key, action, expected, actual });
    };
    for (const p of profiles) {
      await db.assessmentCycle.update({ where: { id: task.id }, data: {
        hrOwnerId: p.owns ? p.user.id : f.actors.owner.id, reviewerId: p.reviews ? p.user.id : f.actors.reviewer.id } });
      const result = { role: p.key };
      for (const [action, endpoint, permitted] of [
        ['goal', '/goal-plans/' + task.taskId, p.goal],
        ['full_assessment', '/tasks/' + task.taskId, p.full],
        ['lifecycle', '/performance-lifecycle/task/' + task.taskId, p.goal],
        ['talent', '/talents/' + f.candidateId, p.talent],
      ]) {
        const r = await http(p, endpoint); result[action] = r.status;
        check(p, action, r.status, p.disabled ? 401 : permitted ? 200 : 403);
        if (action === 'lifecycle' && r.status === 200) {
          check(p, 'terminate_button', r.data.allowedActions.includes('lifecycle_terminate'), Boolean(p.manage));
          check(p, 'premature_delete_button', r.data.allowedActions.includes('lifecycle_delete'), false);
        }
      }
      const progress = await http(p, '/assessment-periods/cycle/' + task.id + '/monitoring');
      result.monthly = progress.status;
      check(p, 'monthly', progress.status, p.disabled ? 401 : p.monthly === undefined ? 403 : 200);
      if (progress.status === 200 && p.monthly !== undefined) {
        check(p, 'monthly_total', progress.data.total, p.monthly);
        if (p.masked) for (const field of ['selfScoreTotal', 'managerScoreTotal', 'selfGrade', 'managerGrade'])
          check(p, field, progress.data.items[0]?.[field], null);
        if (p.reviews) check(p, 'reviewer_cannot_reopen', progress.data.items[0].canReopen, false);
      }
      const reconciled = await http(p, '/talent-interviews/' + f.interviewId + '/reconcile-calendar', { version: 1 });
      result.calendar = reconciled.status; check(p, 'calendar', reconciled.status, p.disabled ? 401 : p.calendar ? 200 : 403);
      if (reconciled.status === 200) check(p, 'calendar_no_side_effect', reconciled.data.status, 'unconfigured');
      if (!p.manage) for (const action of ['terminate', 'delete']) {
        const original = await db.assessmentTask.findUniqueOrThrow({ where: { id: task.taskId } });
        const denied = await http(p, `/performance-lifecycle/task/${task.taskId}/${action}`, {
          expectedUpdatedAt: original.updatedAt.toISOString(), expectedLifecycleVersion: original.lifecycleVersion,
          reason: '隔离虚构角色矩阵：直接调用不得绕过操作权限' });
        check(p, 'unauthorized_' + action, denied.status, p.disabled ? 401 : 403);
      }
      rows.push(result);
    }
    for (const p of profiles.filter(p => p.manage)) {
      const cycle = await db.assessmentCycle.create({ data: { name: f.prefix + ' 虚构生命周期' + p.key,
        type: 'monthly', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30'),
        hrOwnerId: p.user.id, notificationMode: 'off' } });
      const item = await db.assessmentTask.create({ data: { cycleId: cycle.id, employeeId: f.actors.employee.id, status: 'pending' } });
      let record = await http(p, '/performance-lifecycle/task/' + item.id);
      check(p, 'mutation_dialog_read', record.status, 200);
      for (const action of ['terminate', 'delete']) {
        if (record.status !== 200 && record.status !== 201) break;
        record = await http(p, `/performance-lifecycle/task/${item.id}/${action}`, {
          expectedUpdatedAt: record.data.updatedAt, expectedLifecycleVersion: record.data.lifecycleVersion,
          reason: '隔离虚构角色矩阵验收，不操作真实记录' });
        check(p, action, record.status, 201);
        // The UI opens each action from a fresh read, including the DB-generated version stamp.
        record = await http(p, '/performance-lifecycle/task/' + item.id);
      }
      check(p, 'two_audits', await db.auditLog.count({ where: { entityId: item.id,
        action: { in: ['lifecycle_terminated', 'lifecycle_deleted'] } } }), 2);
    }
    check({ key: 'all' }, 'no_calendar_writes', await db.auditLog.count({ where: { entityId: f.interviewId } }), 0);
    const ids = [...new Set([...Object.values(f.actors).map(actor => actor.id), ...profiles.map(p => p.user.id)])];
    await db.user.updateMany({ where: { id: { in: ids }, name: { startsWith: f.prefix } }, data: { archivedAt: new Date() } });
    await db.talentCandidate.updateMany({ where: { id: f.candidateId, name: { startsWith: f.prefix } }, data: { deletedAt: new Date() } });
    process.stdout.write(JSON.stringify({ profiles: profiles.length, requests, rows, failures, fictional: true,
      realCalendarCalls: 0, productionWrites: 0 }) + '\n');
    if (failures.length) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}

if (require.main === module) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
    input: `(${inPreview.toString()})().catch(e=>{process.stdout.write(JSON.stringify({failed:true,name:e.name,code:e.code})+'\\n');process.exitCode=1});`,
    encoding: 'utf8', timeout: 180000,
  });
  process.stdout.write(result.stdout || 'No role-matrix proof returned.\n');
  if (result.status !== 0 || result.error) process.exitCode = 1;
}

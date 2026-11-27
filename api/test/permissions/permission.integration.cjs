'use strict';

async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('reflect-metadata');
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { PrismaClient } = require('@prisma/client');
  const { JwtService } = require('@nestjs/jwt');
  const { InterviewCalendarReconciliationService } = require('./dist/src/dingtalk/interview-calendar-reconciliation.service');
  const { createFixture } = require('./test/permissions/permission-fixture.cjs');
  const db = new PrismaClient({ log: [] }), other = new PrismaClient({ log: [] });
  const cases = []; let currentCase = 'fixture';
  const pass = name => { cases.push(name); process.stdout.write(JSON.stringify({ case: name, passed: true }) + '\n'); };
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  try {
    const f = await createFixture(db);
    const actor = name => ({ id: f.actors[name].id });
    const token = name => new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: f.actors[name].id,
      employeeNo: f.actors[name].employeeNo }, { expiresIn: '5m' });
    const http = async (name, endpoint, expected = 200, body) => {
      const response = await fetch('http://127.0.0.1:3000/api/v1' + endpoint, { method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${token(name)}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, expected, currentCase + ' ' + endpoint);
      const envelope = await response.json(); return expected < 300 ? envelope.data : envelope;
    };
    const monitoring = id => `/assessment-periods/cycle/${id}/monitoring`;
    currentCase = 'owner_progress_without_score_or_personnel_access';
    const owned = await http('owner', monitoring(f.cycles[0].id));
    assert.equal(owned.total, 1); assert.equal(owned.summary.managerCompleted, 1);
    assert.equal(owned.items[0].canReopen, true);
    for (const field of ['selfScoreTotal', 'managerScoreTotal', 'selfGrade', 'managerGrade']) assert.equal(owned.items[0][field], null);
    await http('owner', '/tasks/' + f.cycles[0].taskId, 403);
    await http('owner', '/employee-archives/' + f.actors.employee.id, 403);
    assert.equal((await http('owner', monitoring(f.cycles[1].id))).total, 0);
    pass(currentCase);
    currentCase = 'explicit_reviewer_progress_only';
    const reviewed = await http('reviewer', monitoring(f.cycles[0].id));
    assert.equal(reviewed.total, 1); assert.equal(reviewed.items[0].canReopen, false);
    assert.equal(reviewed.items[0].managerScoreTotal, null);
    await http('reviewer', '/assessment-periods/' + f.cycles[0].periodId + '/reopen', 403,
      { expectedVersion: 0, reason: '虚构越权拒绝' });
    pass(currentCase);
    currentCase = 'progress_current_revocation_denied';
    await db.user.update({ where: { id: f.actors.owner.id }, data: { hrCapabilities: [] } });
    await http('owner', monitoring(f.cycles[0].id), 403);
    await db.user.update({ where: { id: f.actors.owner.id }, data: { hrCapabilities: ['cycle_plan_edit', 'performance_publish'] } });
    pass(currentCase);
    currentCase = 'calendar_http_editor_not_archive_editor';
    const before = await db.talentInterview.findUniqueOrThrow({ where: { id: f.interviewId } });
    assert.equal((await http('recruiter', '/talent-interviews/' + f.interviewId + '/reconcile-calendar', 200, { version: 1 })).status, 'unconfigured');
    await http('reader', '/talent-interviews/' + f.interviewId + '/reconcile-calendar', 403, { version: 1 });
    assert.deepEqual(await db.talentInterview.findUniqueOrThrow({ where: { id: f.interviewId } }), before);
    pass(currentCase);

    const auditCount = () => db.auditLog.count({ where: { entityId: f.interviewId, action: 'reconcile_talent_interview_calendar' } });
    const reset = async () => {
      await db.talentInterviewSync.update({ where: { interviewId_version: { interviewId: f.interviewId, version: 1 } },
        data: { status: 'uncertain', calendarEventId: null } });
      await db.talentInterview.update({ where: { id: f.interviewId }, data: { syncStatus: 'uncertain', calendarEventId: null } });
    };
    let lookups = 0;
    const calendar = { isEnabled: () => true, locate: async () => { lookups++; return { kind: 'found', eventId: 'fictional_event' }; } };
    const service = new InterviewCalendarReconciliationService(db, calendar);
    currentCase = 'database_editor_requeues_once_without_external_writes';
    const queued = await service.reconcile(f.interviewId, 1, actor('recruiter'));
    assert.equal(queued.status, 'pending'); assert.equal(lookups, 1); assert.equal(await auditCount(), 1);
    assert.equal((await db.talentInterviewSync.findUniqueOrThrow({ where: { interviewId_version: { interviewId: f.interviewId, version: 1 } } })).status, 'pending');
    await assert.rejects(service.reconcile(f.interviewId, 1, actor('recruiter')), e => e.getStatus() === 409);
    assert.equal(await auditCount(), 1); pass(currentCase);

    currentCase = 'database_concurrent_reconciliation_has_one_effect';
    await reset();
    const results = await Promise.allSettled([service.reconcile(f.interviewId, 1, actor('recruiter')),
      service.reconcile(f.interviewId, 1, actor('recruiter'))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.getStatus() === 409).length, 1);
    assert.equal(await auditCount(), 2); pass(currentCase);

    currentCase = 'revocation_commits_before_queued_second_transaction';
    await reset();
    const entered = deferred(), remote = deferred(), held = deferred(), commit = deferred();
    const delayed = new InterviewCalendarReconciliationService(db, { isEnabled: () => true, locate: async () => {
      entered.resolve(); await remote.promise; return { kind: 'found', eventId: 'fictional_event' };
    } });
    const pending = delayed.reconcile(f.interviewId, 1, actor('revoked')).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const revocation = other.$transaction(async tx => {
      await tx.user.update({ where: { id: f.actors.revoked.id }, data: { hrCapabilities: [] } });
      held.resolve(); await commit.promise;
    }, { timeout: 20000 });
    try {
      await held.promise; remote.resolve();
      let waiting = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const [state] = await other.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE usename = current_user AND wait_event_type = 'Lock' AND query LIKE '%FOR SHARE%'`;
        if (state.count > 0) { waiting = true; break; }
        await new Promise(r => setTimeout(r, 50));
      }
      assert.equal(waiting, true, 'reconciliation must actually queue behind the revocation row lock');
    } finally { commit.resolve(); await revocation; }
    assert.equal((await pending).error?.getStatus(), 403);
    assert.equal(await auditCount(), 2);
    assert.equal((await db.talentInterview.findUniqueOrThrow({ where: { id: f.interviewId } })).syncStatus, 'uncertain');
    pass(currentCase);

    currentCase = 'owner_can_reopen_original_period_without_full_task_access';
    await http('owner', '/assessment-periods/' + f.cycles[0].periodId + '/reopen', 200,
      { expectedVersion: 0, reason: '隔离虚构验收：重新开放本人负责周期的月份' });
    assert.equal((await http('owner', monitoring(f.cycles[0].id))).summary.managerCompleted, 0);
    await http('owner', '/tasks/' + f.cycles[0].taskId, 403);
    assert.equal(await db.auditLog.count({ where: { entityId: f.cycles[0].periodId, action: 'monthly_self_evaluation_reopened' } }), 1);
    pass(currentCase);
    process.stdout.write(JSON.stringify({ passed: cases.length, failed: 0, fictional: true, realCalendarCalls: 0 }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ case: currentCase, passed: false, name: e.name, code: e.code,
      assertion: e.code === 'ERR_ASSERTION' ? e.message.slice(0, 300) : undefined }) + '\n');
    process.exitCode = 1;
  } finally { await other.$disconnect(); await db.$disconnect(); }
}

if (require.main === module) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
    input: `(${inPreview.toString()})().catch(()=>{process.exitCode=1});`, encoding: 'utf8', timeout: 120000,
  });
  process.stdout.write(result.stdout || 'No database proof returned.\n');
  if (result.status !== 0 || result.error) process.exitCode = 1;
}

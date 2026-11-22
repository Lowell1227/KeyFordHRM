import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Uses an already-running, refreshed preview; never starts Docker or external transports.
async function inPreview(expectedServiceHash: string) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { createHash, randomUUID } = require('node:crypto');
  const { readFileSync } = require('node:fs');
  assert.equal(createHash('sha256').update(readFileSync('./dist/src/talent-pool/talent-interviews.service.js')).digest('hex'),
    expectedServiceHash, 'Preview dist must match the locally built interview service');
  const { PrismaClient } = require('@prisma/client');
  const { TalentInterviewsService } = require('./dist/src/talent-pool/talent-interviews.service');
  const { TalentRecruitmentService } = require('./dist/src/talent-pool/talent-recruitment.service');
  const db = new PrismaClient();
  const prefix = `RECP_${randomUUID().slice(0, 8)}`;
  const ids = { hr: randomUUID(), removed: randomUUID(), retained: randomUUID(), added: randomUUID(),
    candidate: randomUUID(), interview: randomUUID() };
  const userIds = [ids.hr, ids.removed, ids.retained, ids.added];
  const hr = { id: ids.hr, sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] };
  const removed = { id: ids.removed, sysRole: 'employee', hrCapabilities: [] };
  const interviews = new TalentInterviewsService(db), recruitment = new TalentRecruitmentService(db);
  const failure = new Error('Synthetic removed-participant notification fault');
  let inject = false, injectedFailures = 0;
  db.$use(async (params: any, next: any) => {
    if (inject && params.model === 'NotificationLog' && params.action === 'createMany'
      && params.args.data.some((log: any) => log.extraData?.action === 'participant_removed')) {
      injectedFailures++;
      throw failure;
    }
    return next(params);
  });
  async function state() {
    return {
      interview: await db.talentInterview.findUnique({ where: { id: ids.interview }, include: { participants: { orderBy: { userId: 'asc' } } } }),
      syncs: await db.talentInterviewSync.findMany({ where: { interviewId: ids.interview }, orderBy: { version: 'asc' } }),
      audit: await db.auditLog.findMany({ where: { entityId: ids.interview }, orderBy: { id: 'asc' } }),
      notifications: await db.notificationLog.findMany({ where: { userId: { in: userIds } }, orderBy: { dedupeKey: 'asc' } }),
      feedback: await db.talentInterviewFeedback.findMany({ where: { interviewId: ids.interview }, orderBy: { userId: 'asc' } }),
      feedbackEvents: await db.talentInterviewFeedbackEvent.findMany({ where: { interviewId: ids.interview }, orderBy: { id: 'asc' } }),
    };
  }
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
    assert.equal((await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }))?.value?.fictional, true);
    await db.$transaction(async (tx: any) => {
      for (const [index, id] of userIds.entries()) await tx.user.create({ data: { id, name: `${prefix}_${index}`,
        employeeNo: `${prefix}_${index}`, accountType: 'service', status: 'active',
        sysRole: index === 0 ? 'hr_user' : 'employee', hrCapabilities: index === 0 ? ['employee_archive_edit'] : [] } });
      await tx.talentCandidate.create({ data: { id: ids.candidate, name: prefix, phone: prefix, sourceChannel: 'other', createdById: ids.hr } });
    });
    const draft = { requestId: ids.interview, candidateId: ids.candidate, startsAt: '2035-12-01T02:00:00Z', endsAt: '2035-12-01T03:00:00Z',
      participantIds: [ids.hr, ids.removed, ids.retained], invitationText: `${prefix} private invitation`,
      meetingUrl: 'https://meeting.tencent.com/dm/synthetic-removal', note: `${prefix} private note` };
    await interviews.create(draft, hr);
    const created = await state();
    assert.equal(created.notifications.length, 3);
    await interviews.create(draft, hr);
    assert.deepEqual(await state(), created);
    await recruitment.saveFeedback(ids.interview, { interviewVersion: 1, expectedRevision: 0,
      submit: true, outcome: 'pending', summary: `${prefix} retained feedback` }, removed);
    const before = await state();
    const input = { version: 1, participantIds: [ids.retained, ids.added], note: `${prefix} changed note` };
    inject = true;
    await assert.rejects(interviews.update(ids.interview, input, hr), (error: unknown) => error === failure);
    inject = false;
    assert.equal(injectedFailures, 1);
    assert.deepEqual(await state(), before, 'Notification failure must roll back every transactional write');
    assert.equal((await interviews.detail(ids.interview, removed)).version, 1);
    assert.equal((await recruitment.feedback(ids.interview, removed)).own.status, 'submitted');

    await interviews.update(ids.interview, input, hr);
    const updated = await state();
    assert.equal(updated.interview.version, 2);
    assert.equal(updated.interview.note, input.note);
    assert.deepEqual(updated.interview.participants.map((p: any) => p.userId).sort(), [ids.retained, ids.added].sort());
    assert.deepEqual(updated.feedback, before.feedback);
    assert.deepEqual(updated.feedbackEvents, before.feedbackEvents);
    const notices = updated.notifications.filter((log: any) => log.extraData.version === 2);
    assert.equal(notices.length, 4); assert.equal(updated.notifications.length, 7);
    assert.equal(new Set(notices.map((log: any) => log.dedupeKey)).size, 4);
    for (const log of notices) {
      const cancelled = [ids.hr, ids.removed].includes(log.userId);
      assert.equal(log.dedupeKey, `talent_interview:${ids.interview}:2:${log.userId}`);
      assert.equal(log.title, cancelled ? '面试参与已取消' : '面试邀约已更新');
      assert.deepEqual(log.extraData, { invitationId: ids.interview, version: 2, ...(cancelled ? { action: 'participant_removed' } : {}) });
      assert.equal(log.channel, 'system'); assert.equal(log.status, 'sent'); assert.equal(log.isRead, false);
      for (const privateValue of [prefix, draft.invitationText, draft.meetingUrl, draft.note, input.note]) assert.ok(!JSON.stringify(log).includes(privateValue));
    }
    const audit = updated.audit.find((log: any) => log.action === 'update_talent_interview');
    assert.deepEqual([...audit.oldValue.participantIds].sort(), [ids.hr, ids.removed, ids.retained].sort());
    assert.deepEqual([...audit.newValue.participantIds].sort(), [ids.retained, ids.added].sort());
    assert.deepEqual(updated.syncs.map((sync: any) => [sync.version, sync.status]), [[1, 'superseded'], [2, 'unconfigured']]);
    const isNotFound = (error: any) => error.getStatus() === 404;
    await assert.rejects(interviews.detail(ids.interview, removed), isNotFound);
    await assert.rejects(recruitment.feedback(ids.interview, removed), isNotFound);
    await assert.rejects(recruitment.saveFeedback(ids.interview, { interviewVersion: 2, expectedRevision: 1, submit: false }, removed), isNotFound);
    assert.deepEqual(await interviews.list({ scope: 'mine' }, removed), []);
    assert.equal((await interviews.detail(ids.interview, hr)).candidateId, ids.candidate);
    assert.equal((await recruitment.feedback(ids.interview, hr)).items[0].userId, ids.removed);
    await assert.rejects(interviews.update(ids.interview, input, hr), (error: any) => error.getStatus() === 409);
    assert.deepEqual(await state(), updated);
    await interviews.retrySync(ids.interview, { version: 2 }, hr);
    const retried = await state();
    assert.equal(retried.interview.version, 3);
    assert.deepEqual(retried.notifications, updated.notifications);
    await interviews.cancel(ids.interview, { version: 3 }, hr);
    const cancelled = await state();
    assert.equal(cancelled.interview.status, 'cancelled'); assert.equal(cancelled.interview.version, 4);
    assert.equal(cancelled.notifications.length, 9);
    assert.deepEqual(cancelled.notifications.filter((log: any) => log.extraData.version === 4).map((log: any) => log.userId).sort(),
      [ids.retained, ids.added].sort());
    assert.equal(cancelled.notifications.filter((log: any) => log.extraData.action === 'participant_removed').length, 2);
    return { ok: true, database: 'hrm_preview', injectedFailures, rollback: true, removedAccessDenied: true,
      independentHrReadPreserved: true, notifications: [created.notifications.length, updated.notifications.length,
        retried.notifications.length, cancelled.notifications.length], externalCalls: 0 };
  } finally {
    inject = false;
    try {
      await db.$transaction(async (tx: any) => {
        const candidate = await tx.talentCandidate.findUnique({ where: { id: ids.candidate } });
        if (candidate) assert.equal(candidate.name, prefix, 'Fixture ownership mismatch');
        await tx.notificationLog.deleteMany({ where: { userId: { in: userIds } } });
        await tx.talentInterviewFeedbackEvent.deleteMany({ where: { interviewId: ids.interview } });
        await tx.talentInterviewFeedback.deleteMany({ where: { interviewId: ids.interview } });
        await tx.talentInterviewSync.deleteMany({ where: { interviewId: ids.interview } });
        await tx.talentInterviewParticipant.deleteMany({ where: { interviewId: ids.interview } });
        await tx.talentInterview.deleteMany({ where: { id: ids.interview, candidateId: ids.candidate } });
        await tx.auditLog.deleteMany({ where: { entityId: ids.interview, userId: { in: userIds } } });
        await tx.talentCandidate.deleteMany({ where: { id: ids.candidate, name: prefix } });
        await tx.user.deleteMany({ where: { id: { in: userIds }, name: { startsWith: `${prefix}_` } } });
        assert.equal(await tx.user.count({ where: { id: { in: userIds } } }), 0);
        assert.equal(await tx.talentCandidate.count({ where: { id: ids.candidate } }), 0);
        assert.equal(await tx.talentInterview.count({ where: { id: ids.interview } }), 0);
        assert.equal(await tx.notificationLog.count({ where: { userId: { in: userIds } } }), 0);
      });
    } finally { await db.$disconnect(); }
  }
}

it('verifies removed-participant notices, real transactional rollback and unchanged HR access in isolated preview', () => {
  expect(process.env.HRM_REC_PARTICIPANT_REMOVAL_INTEGRATION).toBe('1');
  const format = '{"project":"{{index .Config.Labels "com.docker.compose.project"}}","service":"{{index .Config.Labels "com.docker.compose.service"}}","running":{{.State.Running}},"networks":{{json .NetworkSettings.Networks}}}';
  const container = JSON.parse(execFileSync('docker', ['inspect', '--format', format, 'hrm-api-1'],
    { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }));
  expect(container).toMatchObject({ project: 'hrm', service: 'api', running: true });
  expect(Object.keys(container.networks)).toEqual(['hrm_internal']);
  const expectedHash = createHash('sha256').update(readFileSync(resolve('dist/src/talent-pool/talent-interviews.service.js'))).digest('hex');
  let output: string;
  try {
    output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
      input: `(${inPreview.toString()})(${JSON.stringify(expectedHash)}).then(result => process.stdout.write(JSON.stringify(result)))
        .catch(() => { process.stdout.write(JSON.stringify({ ok: false })); process.exitCode = 1; });`,
    });
  } catch { throw new Error('REC participant removal integration failed; subprocess output withheld to protect credentials'); }
  expect(JSON.parse(output)).toEqual({ ok: true, database: 'hrm_preview', injectedFailures: 1, rollback: true,
    removedAccessDenied: true, independentHrReadPreserved: true, notifications: [3, 7, 7, 9], externalCalls: 0 });
  console.info('REC participant removal PostgreSQL: rollback, access, notices and cleanup passed');
}, 90000);

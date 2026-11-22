import { execFileSync } from 'node:child_process';

// Requires an explicitly refreshed isolated preview. No AppModule, scheduler or external transport is started.
async function runNotificationAtomicityInPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { TalentInterviewsService } = require('./dist/src/talent-pool/talent-interviews.service');
  const db = new PrismaClient();
  const prefix = `TNA_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const ids = { actor: randomUUID(), first: randomUUID(), second: randomUUID(), candidate: randomUUID(), interview: randomUUID() };
  const userIds = [ids.actor, ids.first, ids.second];
  const fault = new Error('Synthetic transactional inbox insert failure');
  let inject = false, injectedFailures = 0, initialized = false;
  const evidence = { database: '', role: '', injectedFailures: 0, notificationsAfterCreate: 0,
    notificationsAfterReplay: 0, notificationsAfterUpdate: 0, notificationsAfterCalendarRetry: 0,
    rolledBack: [] as string[], cleanup: {} as Record<string, number> };
  db.$use(async (params: any, next: any) => {
    if (inject && params.model === 'NotificationLog' && params.action === 'createMany') {
      injectedFailures++;
      throw fault;
    }
    return next(params);
  });
  async function state() {
    return {
      interview: await db.talentInterview.findUnique({ where: { id: ids.interview }, include: {
        participants: { orderBy: { userId: 'asc' } },
      } }),
      syncs: await db.talentInterviewSync.findMany({ where: { interviewId: ids.interview }, orderBy: { version: 'asc' } }),
      notifications: await db.notificationLog.findMany({ where: { userId: { in: [ids.first, ids.second] } }, orderBy: { dedupeKey: 'asc' } }),
      audit: await db.auditLog.findMany({ where: { entityId: ids.interview }, orderBy: { id: 'asc' } }),
    };
  }
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
    assert.ok(await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }));
    evidence.database = identity.db; evidence.role = identity.role;
    await db.$transaction(async (tx: any) => {
      for (const [suffix, id] of Object.entries({ HR: ids.actor, A: ids.first, B: ids.second })) {
        await tx.user.create({ data: { id, employeeNo: `${prefix}_${suffix}`, name: `${prefix} ${suffix}`,
          accountType: 'service', status: 'active', sysRole: suffix === 'HR' ? 'hr_user' : 'employee',
          hrCapabilities: suffix === 'HR' ? ['employee_archive_edit'] : [] } });
      }
      await tx.talentCandidate.create({ data: { id: ids.candidate, name: `${prefix} candidate`,
        phone: `${prefix}_phone`, sourceChannel: 'other', createdById: ids.actor } });
    });
    initialized = true;
    const actor = { id: ids.actor, name: `${prefix} HR`, sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] };
    const service = new TalentInterviewsService(db);
    const draft = { requestId: ids.interview, candidateId: ids.candidate,
      startsAt: '2035-12-01T02:00:00Z', endsAt: '2035-12-01T03:00:00Z',
      participantIds: [ids.first, ids.second], invitationText: `${prefix} private invitation`,
      meetingUrl: 'https://meeting.tencent.com/dm/synthetic-atomicity', note: `${prefix} private note` };
    const empty = await state();
    inject = true;
    await assert.rejects(service.create(draft, actor), (error: unknown) => error === fault);
    assert.deepEqual(await state(), empty);
    evidence.rolledBack.push('create');
    inject = false;
    await service.create(draft, actor);
    const created = await state();
    assert.equal(created.interview.version, 1);
    assert.equal(created.interview.participants.length, 2);
    assert.equal(created.syncs.length, 1); assert.equal(created.audit.length, 1);
    assert.equal(created.notifications.length, 2);
    for (const log of created.notifications) {
      assert.equal(log.channel, 'system'); assert.equal(log.status, 'sent'); assert.equal(log.isRead, false);
      assert.equal(log.readAt, null); assert.ok(log.sentAt);
      assert.equal(log.dedupeKey, `talent_interview:${ids.interview}:1:${log.userId}`);
      assert.deepEqual(log.extraData, { invitationId: ids.interview, version: 1 });
      for (const secret of [draft.invitationText, draft.note, draft.meetingUrl, `${prefix} candidate`]) {
        assert.ok(!JSON.stringify(log).includes(secret));
      }
    }
    evidence.notificationsAfterCreate = created.notifications.length;
    await service.create(draft, actor);
    assert.deepEqual(await state(), created);
    evidence.notificationsAfterReplay = (await state()).notifications.length;
    for (const action of ['update', 'cancel', 'complete']) {
      inject = true;
      const input = action === 'update'
        ? { version: 1, participantIds: [ids.second], note: `${prefix} changed` } : { version: 1 };
      await assert.rejects(service[action](ids.interview, input, actor), (error: unknown) => error === fault);
      assert.deepEqual(await state(), created);
      evidence.rolledBack.push(action);
      inject = false;
    }
    await service.update(ids.interview, { version: 1, participantIds: [ids.second], note: `${prefix} changed` }, actor);
    const updated = await state();
    assert.equal(updated.interview.version, 2);
    assert.deepEqual(updated.interview.participants.map((p: any) => p.userId), [ids.second]);
    assert.deepEqual(updated.syncs.map((s: any) => [s.version, s.status]), [[1, 'superseded'], [2, 'unconfigured']]);
    assert.equal(updated.audit.length, 2); assert.equal(updated.notifications.length, 4);
    const latest = updated.notifications.filter((log: any) => log.extraData.version === 2);
    assert.deepEqual(latest.map((log: any) => log.userId).sort(), [ids.first, ids.second].sort());
    const retainedNotice = latest.find((log: any) => log.userId === ids.second);
    assert.equal(retainedNotice.title, '面试邀约已更新');
    assert.equal(retainedNotice.dedupeKey, `talent_interview:${ids.interview}:2:${ids.second}`);
    assert.deepEqual(retainedNotice.extraData, { invitationId: ids.interview, version: 2 });
    const removedNotice = latest.find((log: any) => log.userId === ids.first);
    assert.equal(removedNotice.title, '面试参与已取消');
    assert.equal(removedNotice.content, '你已不再参与此面试，无需参加或填写反馈。');
    assert.equal(removedNotice.dedupeKey, `talent_interview:${ids.interview}:2:${ids.first}`);
    assert.deepEqual(removedNotice.extraData, { invitationId: ids.interview, version: 2, action: 'participant_removed' });
    assert.equal(removedNotice.senderId, ids.actor);
    assert.equal(removedNotice.type, 'talent_interview');
    assert.equal(removedNotice.channel, 'system'); assert.equal(removedNotice.status, 'sent');
    assert.equal(removedNotice.isRead, false); assert.equal(removedNotice.readAt, null); assert.ok(removedNotice.sentAt);
    evidence.notificationsAfterUpdate = updated.notifications.length;
    inject = true;
    await service.retrySync(ids.interview, { version: 2 }, actor);
    const retried = await state();
    assert.equal(retried.interview.version, 3);
    assert.equal(retried.interview.calendarSyncedVersion, 0);
    assert.deepEqual(retried.notifications, updated.notifications);
    assert.deepEqual(retried.notifications.filter((log: any) => log.userId === ids.first
      && log.extraData.action === 'participant_removed'), [removedNotice]);
    assert.equal(retried.notifications.filter((log: any) => log.extraData.version === 3).length, 0);
    evidence.notificationsAfterCalendarRetry = retried.notifications.length;
    evidence.injectedFailures = injectedFailures;
    assert.equal(injectedFailures, 4);
  } finally {
    inject = false;
    try {
      if (initialized) await db.$transaction(async (tx: any) => {
        assert.equal(await tx.user.count({ where: { id: { in: userIds }, employeeNo: { startsWith: `${prefix}_` } } }), 3);
        assert.equal(await tx.talentCandidate.count({ where: { id: ids.candidate, createdById: ids.actor, name: `${prefix} candidate` } }), 1);
        const invitation = await tx.talentInterview.findUnique({ where: { id: ids.interview } });
        if (invitation) {
          assert.equal(invitation.candidateId, ids.candidate); assert.equal(invitation.createdById, ids.actor);
        }
        await tx.notificationLog.deleteMany({ where: { userId: { in: userIds } } });
        await tx.talentInterviewSync.deleteMany({ where: { interviewId: ids.interview } });
        await tx.talentInterviewParticipant.deleteMany({ where: { interviewId: ids.interview } });
        await tx.auditLog.deleteMany({ where: { entityId: ids.interview, userId: ids.actor } });
        await tx.talentInterview.deleteMany({ where: { id: ids.interview, candidateId: ids.candidate, createdById: ids.actor } });
        await tx.talentCandidate.deleteMany({ where: { id: ids.candidate, createdById: ids.actor } });
        await tx.user.deleteMany({ where: { id: { in: userIds }, employeeNo: { startsWith: `${prefix}_` } } });
        evidence.cleanup = {
          users: await tx.user.count({ where: { id: { in: userIds } } }),
          candidates: await tx.talentCandidate.count({ where: { id: ids.candidate } }),
          interviews: await tx.talentInterview.count({ where: { id: ids.interview } }),
          participants: await tx.talentInterviewParticipant.count({ where: { interviewId: ids.interview } }),
          syncs: await tx.talentInterviewSync.count({ where: { interviewId: ids.interview } }),
          notifications: await tx.notificationLog.count({ where: { userId: { in: userIds } } }),
          audit: await tx.auditLog.count({ where: { entityId: ids.interview } }),
        };
        assert.ok(Object.values(evidence.cleanup).every(count => count === 0));
      });
    } finally { await db.$disconnect(); }
  }
  return { ok: true, evidence };
}

describe('Talent interview notifications: isolated real PostgreSQL atomicity', () => {
  it('rolls back business, participants, calendar intents, audit and notifications together on an insert fault', () => {
    expect(process.env.HRM_TALENT_NOTIFICATION_ATOMICITY).toBe('1');
    const format = '{"project":"{{index .Config.Labels "com.docker.compose.project"}}","service":"{{index .Config.Labels "com.docker.compose.service"}}","running":{{.State.Running}},"networks":{{json .NetworkSettings.Networks}}}';
    const container = JSON.parse(execFileSync('docker', ['inspect', '--format', format, 'hrm-api-1'],
      { encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] }));
    expect(container).toMatchObject({ project: 'hrm', service: 'api', running: true });
    expect(Object.keys(container.networks)).toEqual(['hrm_internal']);
    let output: string;
    try {
      output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
        encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'],
        input: `(${runNotificationAtomicityInPreview.toString()})().then(result => process.stdout.write(JSON.stringify(result)))
          .catch(() => { process.stdout.write(JSON.stringify({ ok: false })); process.exitCode = 1; });`,
      });
    } catch {
      throw new Error('Preview notification atomicity failed; subprocess output withheld to protect credentials');
    }
    const result = JSON.parse(output);
    expect(result).toEqual({ ok: true, evidence: { database: 'hrm_preview', role: 'hrm_preview', injectedFailures: 4,
      notificationsAfterCreate: 2, notificationsAfterReplay: 2, notificationsAfterUpdate: 4, notificationsAfterCalendarRetry: 4,
      rolledBack: ['create', 'update', 'cancel', 'complete'],
      cleanup: { users: 0, candidates: 0, interviews: 0, participants: 0, syncs: 0, notifications: 0, audit: 0 } } });
    console.info('Talent notification atomicity evidence:', JSON.stringify(result));
  });
});

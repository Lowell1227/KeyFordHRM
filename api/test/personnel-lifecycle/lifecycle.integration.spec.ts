import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import { AuthService } from '@/auth/auth.service';
import { EmployeeEffectiveDateService } from '@/employee-archives/employee-effective-date.service';
import { InterviewCalendarDispatcher } from '@/dingtalk/interview-calendar-dispatcher';
import { InterviewCalendarService } from '@/dingtalk/interview-calendar.service';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Personnel lifecycle: isolated real database and HTTP', () => {
  let app: TestApp;
  let departmentId: string;
  let editor: { id: string; token: string };
  let reviewer: { id: string; token: string };
  let employee: { id: string; token: string };
  let outsider: { id: string; token: string };
  let calendarInvitationId: string;
  const root = '/api/v1/employee-archives';
  const headers = (actor = editor) => ({ Authorization: `Bearer ${actor.token}` });
  const today = '2035-03-20';
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || '');
    const redis = new URL(process.env.REDIS_URL || '');
    if (db.hostname !== '127.0.0.1' || db.port !== '15487' || db.pathname !== '/hrm_lifecycle_test'
      || redis.hostname !== '127.0.0.1' || redis.port !== '16487' || process.env.HRM_LIFECYCLE_QA !== '1') {
      throw new Error('Requires explicitly provisioned disposable personnel lifecycle database and Redis');
    }
    process.env.JWT_SECRET = randomUUID();
    process.env.JWT_EXPIRES_IN = '7d';
    process.env.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY = randomUUID();
    process.env.ENABLE_TEST_QUICK_LOGIN = 'false';
    process.env.DINGTALK_NOTIFICATION_ENABLED = 'false';
    process.env.DINGTALK_INTERVIEW_CALENDAR_ENABLED = 'false';
    process.env.DINGTALK_BOT_STREAM_ENABLED = 'false';
    process.env.DINGTALK_BOT_PREFLIGHT_CONFIRMED = 'false';
    jest.useFakeTimers({ now: new Date(`${today}T04:00:00Z`), doNotFake: [
      'nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
      'setInterval', 'clearInterval', 'queueMicrotask', 'performance', 'hrtime',
    ] });
    app = await buildTestApp();
    app.app.get(SchedulerRegistry).getCronJobs().forEach(job => job.stop());
    departmentId = (await app.prisma.department.create({ data: { name: `虚拟生命周期部门-${randomUUID().slice(0, 6)}` } })).id;
    async function actor(sysRole: 'hr_user' | 'employee', hrCapabilities: string[]) {
      const user = await app.prisma.user.create({ data: { name: `虚拟验收-${randomUUID().slice(0, 6)}`,
        employeeNo: `QA-${randomUUID().slice(0, 7)}`, status: 'active', accountType: 'service', sysRole, hrCapabilities } });
      return { id: user.id, token: (await app.app.get(AuthService).issueToken(user)).token };
    }
    editor = await actor('hr_user', ['employee_archive_edit']);
    reviewer = await actor('hr_user', ['employee_archive_review']);
    employee = await actor('employee', []);
    outsider = await actor('employee', []);
    if (process.env.HRM_LIFECYCLE_WEB_URL) await app.app.listen(3308, '127.0.0.1');
  });
  afterAll(async () => { if (app) await closeTestApp(app); jest.useRealTimers(); });

  async function candidate() {
    return app.prisma.talentCandidate.create({ data: { name: `虚拟候选-${randomUUID().slice(0, 6)}`,
      phone: `139${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      sourceChannel: 'other', createdById: editor.id } });
  }
  async function intake(candidateId: string) {
    const response = await app.http.post(root).set(headers()).send({ name: `虚拟待到岗-${randomUUID().slice(0, 6)}`,
      company: 'fuede', deptId: departmentId, entryDate: today, effectiveFrom: today,
      employmentType: 'full_time', employeeStatus: 'active', talentCandidateId: candidateId });
    expect(response.status).toBe(201);
    return app.prisma.employeeDataChangeRequest.findFirstOrThrow({ where: { talentCandidateId: candidateId } });
  }
  async function approve(id: string) {
    const result = await app.http.post(`${root}/reviews/approve`).set(headers(reviewer)).send({ requestIds: [id], scopes: ['profile'] }).expect(201);
    expect(result.body.data.failed).toEqual([]);
  }
  const currentRequest = (id: string) => app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id } });

  it('keeps reviewed new hires inactive until explicit authorized arrival, then converts the same candidate once', async () => {
    const talent = await candidate();
    const request = await intake(talent.id);
    expect(request.requiresArrivalConfirmation).toBe(true);
    await approve(request.id);
    await app.app.get(EmployeeEffectiveDateService).refreshEffectiveProjections();
    const pending = await currentRequest(request.id);
    expect(pending.onboardingStatus).toBe('pending_entry');
    expect(pending.arrivalConfirmedAt).toBeNull();
    expect(await app.prisma.talentCandidate.findUniqueOrThrow({ where: { id: talent.id } })).toMatchObject({ convertedUserId: null });
    const pendingUser = await app.prisma.user.findUniqueOrThrow({ where: { id: pending.userId! } });
    await expect(app.app.get(AuthService).assertLoginEligibility(pendingUser)).rejects.toThrow();
    const payload = { arrivalDate: today, requestVersion: pending.requestVersion };
    await app.http.post(`${root}/applications/${request.id}/confirm-arrival`).set(headers(editor)).send(payload).expect(403);
    await app.http.post(`${root}/applications/${request.id}/confirm-arrival`).set(headers(employee)).send(payload).expect(403);
    const wrongDate = await app.http.post(`${root}/applications/${request.id}/confirm-arrival`).set(headers(reviewer))
      .send({ ...payload, arrivalDate: '2035-03-21' });
    expect(wrongDate.status).toBe(400);
    await app.http.post(`${root}/applications/${request.id}/confirm-arrival`).set(headers(reviewer)).send(payload).expect(201);
    const effective = await currentRequest(request.id);
    expect(effective).toMatchObject({ onboardingStatus: 'effective', arrivalConfirmedById: reviewer.id });
    expect(effective.arrivalConfirmedAt).not.toBeNull();
    expect(await app.prisma.talentCandidate.findUniqueOrThrow({ where: { id: talent.id } }))
      .toMatchObject({ status: 'hired', convertedUserId: effective.userId });
    const active = await app.prisma.user.findUniqueOrThrow({ where: { id: effective.userId! } });
    await expect(app.app.get(AuthService).assertLoginEligibility(active)).resolves.toBeUndefined();
    const repeat = await app.http.post(`${root}/applications/${request.id}/confirm-arrival`).set(headers(reviewer)).send(payload);
    expect(repeat.status).toBe(201);
    expect((await currentRequest(request.id)).arrivalConfirmedAt).toEqual(effective.arrivalConfirmedAt);
    expect(await app.prisma.employmentRecord.count({ where: { sourceRequestId: request.id } })).toBe(1);
  });

  it('enforces invitation visibility and retains independent processes after forced candidate deletion', async () => {
    const talent = await candidate();
    const request = await intake(talent.id);
    const payload = { candidateId: talent.id, startsAt: `${today}T05:00:00Z`, endsAt: `${today}T06:00:00Z`,
      participantIds: [employee.id], invitationText: '虚拟面试邀请，请按约定时间参会', meetingUrl: 'https://meeting.tencent.com/dm/qa-synthetic', note: '参与人共同可见的虚拟安排说明' };
    await app.http.post('/api/v1/talent-interviews').set(headers(reviewer)).send(payload).expect(403);
    const created = (await app.http.post('/api/v1/talent-interviews').set(headers()).send(payload).expect(201)).body.data;
    expect(created.syncStatus).toBe('unconfigured');
    const minimal = (await app.http.get(`/api/v1/talent-interviews/${created.id}`).set(headers(employee)).expect(200)).body.data;
    expect(minimal.meetingUrl).toBe(payload.meetingUrl);
    expect(minimal.note).toBe(payload.note);
    for (const field of ['candidateId', 'phone', 'followups', 'expectedSalary', 'calendarEventId', 'participants']) expect(minimal).not.toHaveProperty(field);
    await app.http.get(`/api/v1/talent-interviews/${created.id}`).set(headers(outsider)).expect(404);
    await app.http.get(`/api/v1/talents/${talent.id}`).set(headers(employee)).expect(403);
    const impact = (await app.http.get(`/api/v1/talents/${talent.id}/delete-impact`).set(headers()).expect(200)).body.data;
    expect(impact.requiresForce).toBe(true);
    await app.http.delete(`/api/v1/talents/${talent.id}`).set(headers()).send({ impactVersion: impact.version, force: false }).expect(409);
    await app.http.delete(`/api/v1/talents/${talent.id}`).set(headers()).send({ impactVersion: impact.version, force: true }).expect(200);
    expect(await app.prisma.talentCandidate.findUniqueOrThrow({ where: { id: talent.id } })).not.toMatchObject({ deletedAt: null });
    expect((await currentRequest(request.id)).onboardingStatus).toBe(request.onboardingStatus);
    expect((await app.http.get(`/api/v1/talent-interviews/${created.id}`).set(headers(employee)).expect(200)).body.data)
      .toMatchObject({ sourceDeleted: true, status: 'scheduled' });
    await app.http.post('/api/v1/talent-interviews').set(headers()).send(payload).expect(404);
    const retained = (await app.http.get('/api/v1/talent-interviews?scope=created').set(headers()).expect(200)).body.data;
    expect(retained.some((row: any) => row.id === created.id && row.sourceDeleted)).toBe(true);
    await app.http.get('/api/v1/talent-interviews?scope=created').set(headers(employee)).expect(403);
    await approve(request.id);
    const pending = await currentRequest(request.id);
    await app.http.post(`${root}/applications/${request.id}/confirm-arrival`).set(headers(reviewer))
      .send({ arrivalDate: today, requestVersion: pending.requestVersion }).expect(201);
    expect((await app.prisma.talentCandidate.findUniqueOrThrow({ where: { id: talent.id } })).deletedAt).not.toBeNull();
  });

  it('serializes calendar claims and quarantines uncertain outcomes until an authoritative completion arrives', async () => {
    const talent = await candidate();
    for (const userId of [editor.id, employee.id]) await app.prisma.externalIdentityBinding.create({ data: {
      provider: 'dingtalk', userId, externalUnionId: `synthetic-${userId}`, status: 'enabled',
    } });
    const invite = (await app.http.post('/api/v1/talent-interviews').set(headers()).send({
      candidateId: talent.id, startsAt: `${today}T05:00:00Z`, endsAt: `${today}T06:00:00Z`,
      participantIds: [employee.id], invitationText: '虚拟同步并发验收', meetingUrl: 'https://meeting.tencent.com/dm/qa-synthetic',
    }).expect(201)).body.data;
    calendarInvitationId = invite.id;
    const intent = await app.prisma.talentInterviewSync.findUniqueOrThrow({ where: { interviewId_version: { interviewId: invite.id, version: 1 } } });
    await app.prisma.talentInterviewSync.update({ where: { id: intent.id }, data: { status: 'pending' } });
    const dispatcher = app.app.get(InterviewCalendarDispatcher) as any;
    const secondDispatcher = new InterviewCalendarDispatcher(app.prisma, {} as any) as any;
    const claims = await Promise.all([dispatcher.claim(intent.id), secondDispatcher.claim(intent.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean);
    expect(claim.event.organizerUnionId).toBe(`synthetic-${editor.id}`);
    expect(await dispatcher.claim(intent.id)).toBeNull();
    await dispatcher.finish({ ...claim, claimToken: randomUUID() }, 'synced', 'wrong-external-id');
    expect((await app.prisma.talentInterview.findUniqueOrThrow({ where: { id: invite.id } })).calendarEventId).toBeNull();
    await app.prisma.talentInterviewSync.update({ where: { id: intent.id }, data: { claimedAt: new Date(Date.now() - 180000) } });
    await dispatcher.expireClaims();
    expect((await app.prisma.talentInterviewSync.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe('uncertain');
    await app.http.post(`/api/v1/talent-interviews/${invite.id}/retry-sync`).set(headers()).send({ version: 1 }).expect(409);
    await dispatcher.finish(claim, 'synced', 'synthetic-external-event');
    expect(await app.prisma.talentInterview.findUniqueOrThrow({ where: { id: invite.id } }))
      .toMatchObject({ calendarEventId: 'synthetic-external-event', calendarSyncedVersion: 1, syncStatus: 'synced' });
  });

  it('requires re-review for a revised arrival date and disables a departed employee before reentry confirmation', async () => {
    const talent = await candidate();
    const request = await intake(talent.id);
    await approve(request.id);
    const pending = await currentRequest(request.id);
    await app.http.patch(`${root}/applications/${request.id}/arrival-date`).set(headers())
      .send({ arrivalDate: '2035-03-19', requestVersion: pending.requestVersion }).expect(200);
    const revised = await currentRequest(request.id);
    expect(revised.profileReviewStatus).toBe('pending');
    await app.http.post(`${root}/applications/${request.id}/confirm-arrival`).set(headers(reviewer))
      .send({ arrivalDate: '2035-03-19', requestVersion: revised.requestVersion }).expect(409);
    await approve(request.id);
    await app.http.post(`${root}/applications/${request.id}/confirm-arrival`).set(headers(reviewer))
      .send({ arrivalDate: '2035-03-19', requestVersion: (await currentRequest(request.id)).requestVersion }).expect(201);
    const userId = (await currentRequest(request.id)).userId!;
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = (await app.app.get(AuthService).issueToken(user)).token;
    const binding = await app.prisma.externalIdentityBinding.create({ data: { userId, externalUnionId: `synthetic-${userId}`, status: 'enabled' } });
    const departure = (await app.http.post(`${root}/${userId}/employments`).set(headers()).send({
      company: 'fuede', deptId: departmentId, employmentType: 'full_time', employeeStatus: 'resigned',
      changeType: 'resignation', effectiveFrom: today, leaveDate: today, reason: '虚拟离职验收',
    }).expect(201)).body.data;
    await approve(departure.id);
    await app.http.get('/api/v1/auth/me').set({ Authorization: `Bearer ${token}` }).expect(200);
    try {
      jest.setSystemTime(new Date('2035-03-20T16:01:00Z'));
      expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp).toBeGreaterThan(Date.now() / 1000);
      await app.app.get(EmployeeEffectiveDateService).refreshUserProjection(userId);
      await app.http.get('/api/v1/auth/me').set({ Authorization: `Bearer ${token}` }).expect(401);
      expect((await app.prisma.externalIdentityBinding.findUniqueOrThrow({ where: { id: binding.id } })).status).toBe('disabled');
      const reentry = (await app.http.post(`${root}/${userId}/reentry`).set(headers()).send({ company: 'fuede', deptId: departmentId,
        employeeStatus: 'active', employmentType: 'full_time', effectiveDate: '2035-03-21', talentCandidateId: talent.id }).expect(201)).body.data;
      await approve(reentry.id);
      await app.http.patch(`${root}/applications/${reentry.id}/arrival-date`).set(headers())
        .send({ arrivalDate: '2035-03-22', requestVersion: (await currentRequest(reentry.id)).requestVersion }).expect(200);
      const rejected = await app.http.post(`${root}/reviews/reject`).set(headers(reviewer))
        .send({ requestIds: [reentry.id], reason: '虚拟退回，修订到岗部门及日期' }).expect(201);
      expect(rejected.body.data.failed).toEqual([]);
      const revisedDepartment = await app.prisma.department.create({ data: { name: `虚拟新任职部门-${randomUUID().slice(0, 6)}` } });
      await app.http.patch(`${root}/reentry/${reentry.id}`).set(headers()).send({ company: 'fuede', deptId: revisedDepartment.id,
        employeeStatus: 'active', employmentType: 'full_time', effectiveDate: '2035-03-21', talentCandidateId: talent.id }).expect(200);
      await approve(reentry.id);
      const reentryEmployment = await app.prisma.employmentRecord.findFirstOrThrow({ where: { sourceRequestId: reentry.id } });
      expect(reentryEmployment.deptId).toBe(revisedDepartment.id);
      await app.app.get(EmployeeEffectiveDateService).refreshUserProjection(userId);
      await app.http.get('/api/v1/auth/me').set({ Authorization: `Bearer ${token}` }).expect(401);
      await app.http.post(`${root}/applications/${reentry.id}/confirm-arrival`).set(headers(reviewer))
        .send({ arrivalDate: '2035-03-21', requestVersion: (await currentRequest(reentry.id)).requestVersion }).expect(201);
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe('active');
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: userId } })).deptId).toBe(revisedDepartment.id);
      expect((await app.prisma.externalIdentityBinding.findUniqueOrThrow({ where: { id: binding.id } })).status).toBe('enabled');
    } finally { jest.setSystemTime(new Date(`${today}T04:00:00Z`)); }
  });

  it('reconciles an uncertain calendar result using the same remote event and fences late responses', async () => {
    const source = await candidate();
    const invite = (await app.http.post('/api/v1/talent-interviews').set(headers()).send({
      candidateId: source.id, startsAt: `${today}T05:00:00Z`, endsAt: `${today}T06:00:00Z`,
      participantIds: [employee.id], invitationText: '虚拟日程核对验收',
    }).expect(201)).body.data;
    const intent = await app.prisma.talentInterviewSync.findUniqueOrThrow({ where: { interviewId_version: { interviewId: invite.id, version: 1 } } });
    await app.prisma.talentInterviewSync.update({ where: { id: intent.id }, data: { status: 'pending' } });
    const dispatcher = app.app.get(InterviewCalendarDispatcher) as any;
    const firstClaim = await dispatcher.claim(intent.id);
    expect(firstClaim).not.toBeNull();
    await dispatcher.finish(firstClaim, 'uncertain', null);
    const endpoint = `/api/v1/talent-interviews/${invite.id}/reconcile-calendar`;
    await app.http.post(endpoint).set(headers(employee)).send({ version: 1 }).expect(403);
    await app.http.post(endpoint).set(headers(reviewer)).send({ version: 1 }).expect(403);
    expect((await app.http.post(endpoint).set(headers()).send({ version: 1 }).expect(200)).body.data.status).toBe('unconfigured');
    const calendar = app.app.get(InterviewCalendarService);
    const enabled = jest.spyOn(calendar, 'isEnabled').mockReturnValue(true);
    const locate = jest.spyOn(calendar, 'locate').mockResolvedValue({ kind: 'found', eventId: 'synthetic-recovered-event' });
    try {
      await app.http.post(endpoint).set(headers()).send({ version: 2 }).expect(409);
      expect((await app.http.post(endpoint).set(headers()).send({ version: 1 }).expect(200)).body.data.status).toBe('pending');
      expect(locate).toHaveBeenCalledTimes(1);
      await dispatcher.finish(firstClaim, 'synced', 'stale-wrong-event');
      expect(await app.prisma.talentInterview.findUniqueOrThrow({ where: { id: invite.id } }))
        .toMatchObject({ syncStatus: 'pending', calendarEventId: 'synthetic-recovered-event' });
      const resumedClaim = await dispatcher.claim(intent.id);
      expect(resumedClaim.eventId).toBe('synthetic-recovered-event');
      expect(resumedClaim.claimToken).not.toBe(firstClaim.claimToken);
      await dispatcher.finish(resumedClaim, 'synced', resumedClaim.eventId);
      expect(await app.prisma.auditLog.count({ where: { entityId: invite.id, action: 'reconcile_talent_interview_calendar' } })).toBe(1);
    } finally { enabled.mockRestore(); locate.mockRestore(); }
  });

  it('reuses a cancelled pre-arrival identity without inventing employment or resignation history', async () => {
    const source = await candidate();
    const request = await intake(source.id);
    await approve(request.id);
    const original = await currentRequest(request.id);
    await app.http.post(`${root}/applications/${request.id}/cancel`).set(headers()).send({ reason: '虚拟未报到取消' }).expect(201);
    expect(await app.prisma.employmentRecord.count({ where: { userId: original.userId! } })).toBe(0);
    const resumed = (await app.http.patch(`${root}/applications/${request.id}/arrival-date`).set(headers()).send({
      arrivalDate: today, requestVersion: (await currentRequest(request.id)).requestVersion,
    }).expect(200)).body.data;
    expect(resumed.userId).toBe(original.userId);
    expect(resumed.id).toBe(request.id);
    expect(resumed.employeeNo).not.toBe(original.employeeNo);
    expect(await app.prisma.employeeNumberAssignment.count({ where: { sourceRequestId: request.id } })).toBe(1);
    expect((await currentRequest(request.id)).revisionHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ releasedReservation: expect.objectContaining({
        employeeNo: original.employeeNo, status: 'released', sourceRequestId: request.id,
      }) }),
    ]));
    await approve(resumed.id);
    await app.http.post(`${root}/applications/${resumed.id}/confirm-arrival`).set(headers(reviewer))
      .send({ arrivalDate: today, requestVersion: (await currentRequest(resumed.id)).requestVersion }).expect(201);
    expect(await app.prisma.employmentRecord.count({ where: { userId: original.userId!, employeeStatus: 'resigned' } })).toBe(0);
    expect(await app.prisma.employmentRecord.count({ where: { userId: original.userId! } })).toBe(1);
    expect(JSON.stringify((await currentRequest(request.id)).revisionHistory)).toContain('reopen_cancelled_employee_arrival');
    expect(await app.prisma.auditLog.count({ where: { entityId: request.id, action: 'reopen_cancelled_employee_arrival' } })).toBe(1);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: original.userId! } })).status).toBe('active');
  });

  it('serializes competing intake and confirmation/cancellation commands', async () => {
    const talent = await candidate();
    const payload = { name: '虚拟并发申请人', company: 'fuede', deptId: departmentId, entryDate: today, effectiveFrom: today,
      employmentType: 'full_time', employeeStatus: 'active', talentCandidateId: talent.id };
    const results = await Promise.all([app.http.post(root).set(headers()).send(payload), app.http.post(root).set(headers()).send(payload)]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const request = await app.prisma.employeeDataChangeRequest.findFirstOrThrow({ where: { talentCandidateId: talent.id } });
    const duplicate = await app.http.post(root).set(headers()).send(payload).expect(409);
    expect(duplicate.body.data.applicationId).toBe(request.id);
    await approve(request.id);
    const pending = await currentRequest(request.id);
    const commands = await Promise.all([
      app.http.post(`${root}/applications/${request.id}/confirm-arrival`).set(headers(reviewer)).send({ arrivalDate: today, requestVersion: pending.requestVersion }),
      app.http.post(`${root}/applications/${request.id}/cancel`).set(headers()).send({ reason: '虚拟并发撤销' }),
    ]);
    expect(commands.every(result => [201, 400, 409].includes(result.status))).toBe(true);
    const final = await currentRequest(request.id);
    expect(['effective', 'cancelled']).toContain(final.onboardingStatus);
    const current = await app.prisma.user.findUniqueOrThrow({ where: { id: final.userId! } });
    if (final.onboardingStatus === 'effective') {
      expect(final.arrivalConfirmedAt).not.toBeNull(); expect(current.status).toBe('active');
    } else { expect(final.arrivalConfirmedAt).toBeNull(); expect(current.status).not.toBe('active'); }
    expect(await app.prisma.employeeDataChangeRequest.count({ where: { talentCandidateId: talent.id } })).toBe(1);
  });

  describe('boolean queries: real HTTP filters, exports and authorization', () => {
    const prefix = `BQ-${randomUUID().slice(0, 6)}`;
    const people: Record<string, { id: string; employeeNo: string | null }> = {};
    let parentDept: string;
    let childDept: string;
    let inactiveDept: string;
    let scopedHr: { id: string; token: string };
    const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id).sort();
    const expectedIds = (keys: string[]) => keys.map(key => people[key].id).sort();
    const list = async (query: Record<string, string> = {}, actor = editor) => (
      await app.http.get('/api/v1/users').set(headers(actor))
        .query({ keyword: prefix, pageSize: '100', ...query }).expect(200)
    ).body.data;

    beforeAll(async () => {
      parentDept = (await app.prisma.department.create({ data: { name: `${prefix}-parent`, company: 'fuede' } })).id;
      childDept = (await app.prisma.department.create({ data: { name: `${prefix}-child`, parentId: parentDept, company: 'fuede' } })).id;
      inactiveDept = (await app.prisma.department.create({ data: { name: `${prefix}-inactive`, isActive: false, company: 'fuede' } })).id;
      const limited = await app.prisma.user.create({ data: {
        name: `Scoped QA ${randomUUID().slice(0, 6)}`, employeeNo: `SCOPE-${randomUUID().slice(0, 6)}`,
        sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit'], status: 'active', accountType: 'employee',
      } });
      await app.prisma.employmentRecord.create({ data: {
        userId: limited.id, employeeNo: limited.employeeNo, company: 'fuede',
        effectiveFrom: new Date(today), entryDate: new Date(today), employeeStatus: 'active', changeType: 'hire',
      } });
      scopedHr = { id: limited.id, token: (await app.app.get(AuthService).issueToken(limited)).token };
      const definitions: Array<{ key: string; data: Partial<Prisma.UserUncheckedCreateInput> }> = [
        { key: 'active', data: { directManagerId: limited.id } },
        { key: 'probation', data: { status: 'probation', deptId: childDept } },
        { key: 'resigned', data: { status: 'resigned', leaveDate: new Date('2035-03-01') } },
        { key: 'archived', data: { status: 'resigned', archivedAt: new Date(today) } },
        { key: 'archivedActive', data: { archivedAt: new Date(today) } },
        { key: 'unassigned', data: { deptId: null } },
        { key: 'test', data: { accountType: 'test' } },
        { key: 'service', data: { accountType: 'service' } },
        { key: 'deleted', data: { deletedAt: new Date(today) } },
      ];
      for (const { key, data } of definitions) {
        const person = await app.prisma.user.create({ data: {
          name: `${prefix}-${key}`, employeeNo: `${prefix}-${key}`, status: 'active',
          accountType: 'employee', deptId: parentDept, ...data,
        } });
        people[key] = person;
        if (person.accountType === 'employee') {
          await app.prisma.employmentRecord.create({ data: {
            userId: person.id, employeeNo: person.employeeNo, company: 'fuede', deptId: person.deptId,
            directManagerId: person.directManagerId, effectiveFrom: new Date('2035-01-01'),
            entryDate: new Date('2035-01-01'), employeeStatus: person.status, leaveDate: person.leaveDate,
            changeType: person.status === 'resigned' ? 'resign' : 'hire',
          } });
        }
      }
    });

    const rosterCases: Array<{ name: string; query: Record<string, string>; keys: string[]; department?: boolean }> = [
      { name: 'omitted flags', query: {}, keys: ['active', 'probation', 'unassigned'] },
      { name: 'all explicit false', query: { archived: 'false', includeResigned: 'false', includeTestAccounts: 'false', unassigned: 'false' }, keys: ['active', 'probation', 'unassigned'] },
      { name: 'include resigned', query: { archived: 'false', includeResigned: 'true', includeTestAccounts: 'false' }, keys: ['active', 'probation', 'resigned', 'unassigned'] },
      { name: 'include test accounts, not service accounts', query: { archived: 'false', includeResigned: 'false', includeTestAccounts: 'true' }, keys: ['active', 'probation', 'test', 'unassigned'] },
      { name: 'both inclusion flags true', query: { archived: 'false', includeResigned: 'true', includeTestAccounts: 'true' }, keys: ['active', 'probation', 'resigned', 'test', 'unassigned'] },
      { name: 'unassigned true', query: { archived: 'false', unassigned: 'true' }, keys: ['unassigned'], department: true },
      { name: 'unassigned false retains department subtree', query: { archived: 'false', unassigned: 'false' }, keys: ['active', 'probation'], department: true },
      { name: 'archive view preserves its resigned-only semantics', query: { archived: 'true', status: 'active', includeResigned: 'false' }, keys: ['archived'] },
      { name: 'direct-manager eligibility stays current-worker-only', query: { eligibleFor: 'direct_manager', archived: 'false', includeResigned: 'true', includeTestAccounts: 'true' }, keys: ['active', 'probation', 'unassigned'] },
    ];

    it.each(rosterCases)('lists and exports the same exact roster: $name', async ({ query, keys, department }) => {
      const filters = { ...query, ...(department ? { deptId: parentDept } : {}) };
      const result = await list(filters);
      expect(result.total).toBe(keys.length);
      expect(ids(result.items)).toEqual(expectedIds(keys));
      const response = await app.http.get('/api/v1/users/export').set(headers())
        .query({ keyword: prefix, ...filters, columns: 'employeeNo,name' })
        .buffer(true).parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
          res.on('error', done);
        }).expect(200);
      expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toContain('roster-export.xlsx');
      const workbook = new Workbook();
      await workbook.xlsx.load(response.body);
      expect(workbook.worksheets).toHaveLength(1);
      const sheet = workbook.worksheets[0];
      expect(sheet.getRow(1).getCell(1).text).toBe('工号');
      expect(sheet.getRow(1).getCell(2).text).toBe('姓名');
      const exported: string[] = [];
      sheet.eachRow((row, number) => { if (number > 1) exported.push(row.getCell(1).text); });
      expect(exported.sort()).toEqual(keys.map(key => people[key].employeeNo).sort());
      expect(sheet.rowCount).toBe(keys.length + 1);
      const audit = await app.prisma.auditLog.findFirstOrThrow({
        where: { userId: editor.id, action: 'export_employee_roster', newValue: { path: ['filters', 'keyword'], equals: prefix } },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.newValue).toMatchObject({ total: keys.length, columns: ['employeeNo', 'name'], filters: {
        archived: query.archived === 'true', includeResigned: query.includeResigned === 'true',
        includeTestAccounts: query.includeTestAccounts === 'true', unassigned: query.unassigned === 'true',
      } });
    });

    it('keeps list data scope, export capability and anonymous boundaries with explicit flags', async () => {
      for (const flag of ['false', 'true']) {
        const query = { archived: 'false', includeResigned: flag, includeTestAccounts: flag, unassigned: 'false' };
        expect(ids((await list(query, scopedHr)).items)).toEqual([people.active.id]);
        for (const path of ['/api/v1/users', '/api/v1/users/export']) {
          await app.http.get(path).query(query).expect(401);
          await app.http.get(path).set(headers(employee)).query(query).expect(403);
        }
        await app.http.get('/api/v1/users/export').set(headers(scopedHr)).query(query).expect(403);
      }
      expect((await list({ archived: 'true', includeResigned: 'true' }, scopedHr)).items).toEqual([]);
    });

    it('preserves cycle-owner eligibility rather than inferring authority from titles or inclusion flags', async () => {
      const ownerPrefix = `OWNER-${randomUUID().slice(0, 6)}`;
      const eligible: string[] = [];
      for (const [key, status, archived, capability] of [
        ['active', 'active', false, true], ['probation', 'probation', false, true],
        ['resigned', 'resigned', false, true], ['archived', 'active', true, true],
        ['no-capability', 'active', false, false],
      ] as const) {
        const person = await app.prisma.user.create({ data: {
          name: `${ownerPrefix}-${key}`, employeeNo: `${ownerPrefix}-${key}`, sysRole: 'hr_user',
          status, archivedAt: archived ? new Date(today) : null, accountType: 'employee',
          position: 'HR manager', hrCapabilities: capability ? ['cycle_plan_edit'] : [],
        } });
        if (key === 'active' || key === 'probation') eligible.push(person.id);
      }
      const result = await list({ keyword: ownerPrefix, eligibleFor: 'cycle_owner', archived: 'false', includeResigned: 'true', includeTestAccounts: 'false' });
      expect(ids(result.items)).toEqual(eligible.sort());
      expect(result.total).toBe(2);
    });

    it('offers active/probation participants and rejects archived, resigned or deleted IDs on create and update', async () => {
      const active = await list({ status: 'active', archived: 'false', includeTestAccounts: 'false' });
      expect(ids(active.items)).toEqual(expectedIds(['active', 'unassigned']));
      expect(ids((await list({ status: 'probation', archived: 'false' })).items)).toEqual(expectedIds(['probation']));
      const source = await app.prisma.talentCandidate.create({ data: {
        name: `${prefix}-interview`, phone: `100${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`,
        sourceChannel: 'other', createdById: editor.id,
      } });
      const payload = { candidateId: source.id, startsAt: `${today}T07:00:00Z`, endsAt: `${today}T08:00:00Z`,
        participantIds: [people.active.id, people.probation.id], invitationText: 'Fictional boolean-query regression invitation' };
      const created = (await app.http.post('/api/v1/talent-interviews').set(headers()).send(payload).expect(201)).body.data;
      expect(created.participants.map((person: { userId: string }) => person.userId).sort()).toEqual(expectedIds(['active', 'probation']));
      expect(created.syncStatus).toBe('unconfigured');
      for (const key of ['archived', 'archivedActive', 'resigned', 'deleted']) {
        await app.http.post('/api/v1/talent-interviews').set(headers())
          .send({ ...payload, participantIds: [people[key].id] }).expect(400);
        await app.http.patch(`/api/v1/talent-interviews/${created.id}`).set(headers())
          .send({ version: created.version, participantIds: [people.active.id, people[key].id] }).expect(400);
      }
      expect(await app.prisma.talentInterview.count({ where: { candidateId: source.id } })).toBe(1);
      const retained = await app.prisma.talentInterview.findUniqueOrThrow({ where: { id: created.id }, include: { participants: true } });
      expect(retained.version).toBe(created.version);
      expect(retained.participants.map(person => person.userId).sort()).toEqual(expectedIds(['active', 'probation']));
      for (const key of ['active', 'probation']) {
        const person = await app.prisma.user.findUniqueOrThrow({ where: { id: people[key].id } });
        const token = (await app.app.get(AuthService).issueToken(person)).token;
        await app.http.get(`/api/v1/talent-interviews/${created.id}`).set({ Authorization: `Bearer ${token}` }).expect(200);
        await app.http.get(`/api/v1/talents/${source.id}`).set({ Authorization: `Bearer ${token}` }).expect(403);
      }
      await app.http.get(`/api/v1/talent-interviews/${created.id}`).set(headers(outsider)).expect(404);
    });

    it('distinguishes department tree/flat modes and explicit inactive filtering', async () => {
      const get = async (query: Record<string, string>) => (
        await app.http.get('/api/v1/departments').set(headers()).query(query).expect(200)
      ).body.data;
      const treeQueries: Array<Record<string, string>> = [{}, { flat: 'false' }];
      for (const query of treeQueries) {
        const tree = await get(query);
        expect(tree.some((row: { id: string }) => row.id === childDept)).toBe(false);
        expect(tree.find((row: { id: string }) => row.id === parentDept).children)
          .toEqual(expect.arrayContaining([expect.objectContaining({ id: childDept })]));
      }
      expect(ids(await get({ flat: 'true', isActive: 'true' }))).toEqual(expect.arrayContaining([parentDept, childDept]));
      expect(ids(await get({ flat: 'true', isActive: 'true' }))).not.toContain(inactiveDept);
      expect(ids(await get({ flat: 'true', isActive: 'false' }))).toEqual([inactiveDept]);
    });

    it('keeps inactive positions opt-in and retains selector authorization', async () => {
      const active = await app.prisma.position.create({ data: { name: `${prefix}-position-active`, code: `${prefix}-PA` } });
      const inactive = await app.prisma.position.create({ data: { name: `${prefix}-position-inactive`, code: `${prefix}-PI`, isActive: false } });
      for (const includeInactive of [undefined, 'false', 'true']) {
        const query = { keyword: prefix, ...(includeInactive ? { includeInactive } : {}) };
        const result = (await app.http.get('/api/v1/positions').set(headers()).query(query).expect(200)).body.data;
        expect(ids(result)).toEqual((includeInactive === 'true' ? [active.id, inactive.id] : [active.id]).sort());
        await app.http.get('/api/v1/positions').set(headers(employee)).query(query).expect(403);
      }
    });

    it.each(['indicators', 'templates'])('distinguishes active/inactive/default %s lists using persisted rows', async (resource) => {
      const data = { name: `${prefix}-${resource}`, createdBy: editor.id };
      const active = resource === 'indicators'
        ? await app.prisma.indicator.create({ data }) : await app.prisma.assessmentTemplate.create({ data });
      const inactive = resource === 'indicators'
        ? await app.prisma.indicator.create({ data: { ...data, isActive: false } })
        : await app.prisma.assessmentTemplate.create({ data: { ...data, isActive: false } });
      for (const isActive of [undefined, 'false', 'true']) {
        const result = (await app.http.get(`/api/v1/${resource}`).set(headers())
          .query({ keyword: prefix, ...(isActive ? { isActive } : {}) }).expect(200)).body.data;
        expect(result.total).toBe(1);
        expect(ids(result.items)).toEqual([isActive === 'false' ? inactive.id : active.id]);
      }
    });

    it('keeps objective tree/flat response modes and employee visibility unchanged', async () => {
      const parent = await app.prisma.objective.create({ data: { title: `${prefix}-root`, level: 'individual', ownerId: employee.id } });
      const child = await app.prisma.objective.create({ data: { title: `${prefix}-child`, level: 'individual', ownerId: employee.id, parentId: parent.id } });
      const hidden = await app.prisma.objective.create({ data: { title: `${prefix}-hidden`, level: 'individual', ownerId: outsider.id } });
      for (const flat of [undefined, 'false', 'true']) {
        const result = (await app.http.get('/api/v1/objectives').set(headers(employee))
          .query({ keyword: prefix, ...(flat ? { flat } : {}) }).expect(200)).body.data;
        if (flat === 'true') {
          expect(result.total).toBe(2);
          expect(ids(result.items)).toEqual([parent.id, child.id].sort());
        } else {
          expect(ids(result)).toEqual([parent.id]);
          expect(ids(result[0].children)).toEqual([child.id]);
        }
        expect(JSON.stringify(result)).not.toContain(hidden.id);
      }
    });

    it('distinguishes talent due/stale flags without weakening HR-only access', async () => {
      const talentPrefix = `TQ-${randomUUID().slice(0, 6)}`;
      // SQL due filtering uses the database clock, not Jest's frozen application clock.
      const [clock] = await app.prisma.$queryRaw<Array<{ day: Date }>>`SELECT CURRENT_DATE AS day`;
      const talents: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const row = await app.prisma.talentCandidate.create({ data: {
          name: `${talentPrefix}-${index}`, phone: `100${randomUUID().replace(/\D/g, '').padEnd(7, '0').slice(0, 7)}${index}`,
          sourceChannel: 'other', createdById: editor.id, createdAt: new Date(`${today}T00:00:00Z`),
          lastFollowUpAt: new Date(index === 0 ? '2030-01-01' : today),
        } });
        talents.push(row.id);
        await app.prisma.talentFollowUp.create({ data: {
          candidateId: row.id, createdById: editor.id, channel: 'other', summary: 'Fictional query fixture',
          occurredAt: clock.day, nextFollowUpAt: new Date(clock.day.getTime() + (index === 2 ? 86400000 : -86400000)),
        } });
      }
      for (const [query, expected] of [
        [{}, talents], [{ dueOnly: 'false', staleOnly: 'false' }, talents],
        [{ dueOnly: 'true', staleOnly: 'false' }, talents.slice(0, 2)],
        [{ dueOnly: 'false', staleOnly: 'true' }, [talents[0]]],
        [{ dueOnly: 'true', staleOnly: 'true' }, [talents[0]]],
      ] as Array<[Record<string, string>, string[]]>) {
        const response = (await app.http.get('/api/v1/talents').set(headers())
          .query({ keyword: talentPrefix, ...query }).expect(200)).body.data;
        expect(ids(response.items)).toEqual([...expected].sort());
        expect(response.total).toBe(expected.length);
        await app.http.get('/api/v1/talents').set(headers(employee)).query(query).expect(403);
      }
    });

    it.each([
      ['/users', 'archived'], ['/users', 'includeResigned'], ['/users', 'includeTestAccounts'], ['/users', 'unassigned'],
      ['/users/export', 'archived'], ['/departments', 'flat'], ['/departments', 'isActive'],
      ['/positions', 'includeInactive'], ['/objectives', 'flat'], ['/indicators', 'isActive'],
      ['/templates', 'isActive'], ['/talents', 'dueOnly'], ['/talents', 'staleOnly'],
    ])('rejects malformed boolean query at real HTTP boundary: %s %s', async (path, field) => {
      await app.http.get(`/api/v1${path}`).set(headers()).query({ [field]: 'not-a-boolean' }).expect(400);
      await app.http.get(`/api/v1${path}`).set(headers()).query(`${field}=false&${field}=true`).expect(400);
    });
  });

  const webTest = process.env.HRM_LIFECYCLE_WEB_URL ? it : it.skip;
  webTest('real browser: one submit, non-effective autosave, assigned interviews, desktop and mobile', async () => {
    const url = new URL(process.env.HRM_LIFECYCLE_WEB_URL!);
    if (url.hostname !== '127.0.0.1' || url.port !== '5188') throw new Error('Browser must use isolated QA web');
    const { chromium } = require('../../../web/node_modules/playwright');
    const { expect: browserExpect } = require('../../../web/node_modules/@playwright/test');
    const browser = await chromium.launch({ headless: true });
    try {
      for (const width of [1440, 1024, 390]) {
        const user = await app.prisma.user.create({ data: { name: `虚拟浏览器员工-${width}`, employeeNo: `WEB-${randomUUID().slice(0, 7)}`,
          status: 'active', accountType: 'employee', deptId: departmentId, entryDate: new Date(today) } });
        await app.prisma.employmentRecord.create({ data: { userId: user.id, employeeNo: user.employeeNo,
          company: 'fuede', deptId: departmentId, effectiveFrom: new Date(today), entryDate: new Date(today),
          employmentType: 'full_time', employeeStatus: 'active', changeType: 'hire' } });
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
        await context.addInitScript((token: string) => localStorage.setItem('token', token), editor.token);
        const page = await context.newPage();
        await page.goto(`${url.origin}/users`);
        const search = page.getByPlaceholder('搜索姓名、当前工号或历史工号');
        await search.fill(user.employeeNo); await search.press('Enter');
        await browserExpect(page.locator('button:visible').filter({ hasText: /^查看档案$/ })).toHaveCount(1);
        await page.locator('button:visible').filter({ hasText: /^查看档案$/ }).click();
        const drawer = page.locator('.employee-archive-drawer:visible');
        await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
        await browserExpect(drawer.getByRole('button', { name: '保存后关闭', exact: true })).toHaveCount(0);
        await browserExpect(drawer.getByRole('button', { name: '提交', exact: true })).toHaveCount(1);
        const saved = page.waitForResponse((response: any) => response.url().endsWith(`/${user.id}/draft/save`) && response.request().method() === 'PATCH');
        const education = `虚拟学历-${width}`;
        await drawer.locator('[data-archive-field="profile.education"] input').fill(education);
        expect((await saved).status()).toBe(200);
        expect((await app.http.get(`${root}/${user.id}`).set(headers()).expect(200)).body.data.employeeProfile?.education).not.toBe(education);
        await browserExpect(drawer.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
        const submitted = page.waitForResponse((response: any) => response.url().endsWith(`/${user.id}/draft`) && response.request().method() === 'PATCH');
        await drawer.getByRole('button', { name: '提交', exact: true }).click();
        expect((await submitted).status()).toBe(200);
        await browserExpect(drawer.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
        await browserExpect(drawer.getByText(education, { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: `${process.env.TEMP}/hrm-lifecycle-archive-${width}.png` });
        await context.close();

        const participantContext = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
        await participantContext.addInitScript((token: string) => localStorage.setItem('token', token), employee.token);
        const participantPage = await participantContext.newPage();
        await participantPage.goto(`${url.origin}/talent-interviews`);
        await browserExpect(participantPage.locator('.interview-page__list li').first()).toBeVisible();
        await participantPage.locator(`.interview-page__list a[href="/talent-interviews/${calendarInvitationId}"]`).click();
        await browserExpect(participantPage.getByText('虚拟同步并发验收', { exact: true })).toBeVisible();
        await browserExpect(participantPage.getByRole('link', { name: '打开腾讯会议' })).toHaveAttribute('href', 'https://meeting.tencent.com/dm/qa-synthetic');
        expect(await participantPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await participantPage.screenshot({ path: `${process.env.TEMP}/hrm-lifecycle-interview-${width}.png` });
        await participantContext.close();
      }
    } finally { await browser.close(); }
  }, 180000);

  webTest('real browser: HR edits an invitation and explicitly confirms arrival on desktop and mobile', async () => {
    const origin = new URL(process.env.HRM_LIFECYCLE_WEB_URL!).origin;
    const { chromium } = require('../../../web/node_modules/playwright');
    const { expect: browserExpect } = require('../../../web/node_modules/@playwright/test');
    const browser = await chromium.launch({ headless: true });
    try {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Los_Angeles' });
        await context.addInitScript((token: string) => localStorage.setItem('token', token), editor.token);
        const page = await context.newPage();
        const before = await app.prisma.talentInterview.findUniqueOrThrow({ where: { id: calendarInvitationId } });
        await page.goto(`${origin}/talent-interviews`);
        await page.getByRole('tab', { name: '我发起的', exact: true }).click();
        await page.locator(`a[href="/talent-interviews/${calendarInvitationId}"]`).click();
        const panel = page.locator('.interview-panel');
        await panel.getByRole('button', { name: '修改邀约', exact: true }).click();
        await panel.locator('.el-form-item').filter({ hasText: '安排备注' }).locator('textarea').fill(`虚拟统一安排-${width}`);
        const saved = page.waitForResponse((response: any) => response.url().endsWith(`/talent-interviews/${calendarInvitationId}`)
          && response.request().method() === 'PATCH');
        await panel.getByRole('button', { name: '保存邀约', exact: true }).click();
        expect((await saved).status()).toBe(200);
        const after = await app.prisma.talentInterview.findUniqueOrThrow({ where: { id: calendarInvitationId } });
        expect(after.note).toBe(`虚拟统一安排-${width}`);
        expect(after.startsAt).toEqual(before.startsAt);
        expect(after.endsAt).toEqual(before.endsAt);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: `${process.env.TEMP}/hrm-lifecycle-interview-hr-${width}.png` });
        await context.close();

        const source = await candidate();
        const request = await intake(source.id);
        await approve(request.id);
        const reviewerContext = await browser.newContext({ viewport: { width, height: 900 } });
        await reviewerContext.addInitScript((token: string) => localStorage.setItem('token', token), reviewer.token);
        const reviewerPage = await reviewerContext.newPage();
        await reviewerPage.clock.setFixedTime(new Date(`${today}T04:00:00Z`));
        await reviewerPage.goto(`${origin}/entry-exit?tab=arrivals&requestId=${request.id}`);
        const arrival = reviewerPage.locator('.arrival-confirmation');
        await browserExpect(arrival).toBeVisible();
        const confirmed = reviewerPage.waitForResponse((response: any) => response.url().endsWith(`/applications/${request.id}/confirm-arrival`)
          && response.request().method() === 'POST');
        await arrival.getByRole('button', { name: '确认到岗', exact: true }).click();
        expect((await confirmed).status()).toBe(201);
        expect((await currentRequest(request.id)).onboardingStatus).toBe('effective');
        await browserExpect(arrival).toHaveCount(0);
        expect(await reviewerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await reviewerPage.screenshot({ path: `${process.env.TEMP}/hrm-lifecycle-arrival-${width}.png` });
        await reviewerContext.close();

        const returnedSource = await candidate();
        const returnedRequest = await intake(returnedSource.id);
        await approve(returnedRequest.id);
        await app.http.patch(`${root}/applications/${returnedRequest.id}/arrival-date`).set(headers())
          .send({ arrivalDate: '2035-03-19', requestVersion: (await currentRequest(returnedRequest.id)).requestVersion }).expect(200);
        await app.http.post(`${root}/reviews/reject`).set(headers(reviewer))
          .send({ requestIds: [returnedRequest.id], reason: '虚拟日期退回验收' }).expect(201);
        const recoveryContext = await browser.newContext({ viewport: { width, height: 900 } });
        await recoveryContext.addInitScript((token: string) => localStorage.setItem('token', token), editor.token);
        const recoveryPage = await recoveryContext.newPage();
        await recoveryPage.clock.setFixedTime(new Date(`${today}T04:00:00Z`));
        await recoveryPage.goto(`${origin}/entry-exit?talentId=${returnedSource.id}`);
        await browserExpect(recoveryPage).toHaveURL(new RegExp(`requestId=${returnedRequest.id}`));
        const datePanel = recoveryPage.locator('.arrival-confirmation');
        await browserExpect(datePanel.getByRole('heading', { name: '修订到岗日期' })).toBeVisible();
        await datePanel.getByRole('button', { name: '修改到岗日期', exact: true }).click();
        await datePanel.locator('input').fill(today);
        await datePanel.locator('input').press('Tab');
        const resubmitted = recoveryPage.waitForResponse((response: any) => response.url().endsWith(`/applications/${returnedRequest.id}/arrival-date`)
          && response.request().method() === 'PATCH');
        await datePanel.getByRole('button', { name: '提交日期变更', exact: true }).click();
        expect((await resubmitted).status()).toBe(200);
        expect((await currentRequest(returnedRequest.id)).profileReviewStatus).toBe('pending');
        expect(await app.prisma.employeeDataChangeRequest.count({ where: { talentCandidateId: returnedSource.id } })).toBe(1);
        await app.http.post(`${root}/applications/${returnedRequest.id}/cancel`).set(headers())
          .send({ reason: '虚拟取消后恢复验收' }).expect(201);
        await recoveryPage.goto(`${origin}/entry-exit?tab=arrivals&requestId=${returnedRequest.id}`);
        await browserExpect(datePanel.getByRole('heading', { name: '重新办理入职' })).toBeVisible();
        expect((await currentRequest(returnedRequest.id)).onboardingStatus).toBe('cancelled');
        await datePanel.getByRole('button', { name: '重新办理入职', exact: true }).click();
        const reopened = recoveryPage.waitForResponse((response: any) => response.url().endsWith(`/applications/${returnedRequest.id}/arrival-date`)
          && response.request().method() === 'PATCH');
        await datePanel.getByRole('button', { name: '重新提交审核', exact: true }).click();
        expect((await reopened).status()).toBe(200);
        expect((await currentRequest(returnedRequest.id)).onboardingStatus).toBe('submitted');
        expect((await currentRequest(returnedRequest.id)).arrivalConfirmedAt).toBeNull();
        expect(await app.prisma.employeeDataChangeRequest.count({ where: { talentCandidateId: returnedSource.id } })).toBe(1);
        await recoveryContext.close();
      }
    } finally { await browser.close(); }
  }, 180000);
});

import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuthService } from '@/auth/auth.service';
import { EmployeeEffectiveDateService } from '@/employee-archives/employee-effective-date.service';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

/** Dedicated disposable PostgreSQL only. No production seed, reset or delete is used. */
describe('Personnel lifecycle real HTTP/database acceptance', () => {
  let app: TestApp;
  let token: string;
  let deptId: string;
  let adminId: string;
  const runId = randomUUID().slice(0, 8);

  function clock(value: string) {
    jest.useFakeTimers({ now: new Date(value), doNotFake: [
      'nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
      'setInterval', 'clearInterval', 'queueMicrotask', 'performance', 'hrtime',
    ] });
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/hrm_lifecycle_test') {
      throw new Error('This suite requires an isolated loopback hrm_lifecycle_test database');
    }
    process.env.JWT_SECRET = randomUUID();
    process.env.JWT_EXPIRES_IN = '8h';
    process.env.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY = randomUUID();
    process.env.ENABLE_TEST_QUICK_LOGIN = 'false';
    process.env.DINGTALK_NOTIFICATION_ENABLED = 'false';
    app = await buildTestApp();
    app.app.get(SchedulerRegistry).getCronJobs().forEach((job) => job.stop());
    const department = await app.prisma.department.create({ data: { name: `虚拟验收部门-${runId}` } });
    deptId = department.id;
    const admin = await app.prisma.user.create({ data: {
      name: `虚拟审核员-${runId}`, employeeNo: `TEST-HR-${runId}`, accountType: 'service',
      status: 'active', sysRole: 'hr', deptId,
    } });
    adminId = admin.id;
  });

  beforeEach(async () => {
    clock('2035-03-20T15:00:00.000Z');
    token = (await app.app.get(AuthService).issueToken(
      (await app.prisma.user.findUniqueOrThrow({ where: { id: adminId } })),
    )).token;
  });

  afterEach(() => jest.useRealTimers());
  afterAll(async () => { if (app) await closeTestApp(app); });

  const headers = () => ({ Authorization: `Bearer ${token}` });
  const newEmployee = (name: string, extra: Record<string, unknown> = {}) => ({
    name, company: 'fuede', deptId, entryDate: '2035-03-01', effectiveFrom: '2035-03-01',
    employmentType: 'full_time', employeeStatus: 'active', positionId: '',
    rosterManagerId: '', performanceManagerId: '',
    employee: { position: '虚拟岗位', plannedRegularDate: '', actualRegularDate: '', leaveDate: '' },
    profile: { birthDate: '', graduationDate: '', socialSecurityStartDate: '', housingFundStartDate: '' },
    contracts: [], ...extra,
  });

  async function approve(requestId: string, scopes = ['profile', 'performance']) {
    const result = await app.http.post('/api/v1/employee-archives/reviews/approve').set(headers())
      .send({ requestIds: [requestId], scopes }).expect(201);
    expect(result.body.data.failed).toEqual([]);
    expect(result.body.data.succeeded).toEqual([expect.objectContaining({ requestId })]);
  }

  async function createFormalEmployee(name: string, extra: Record<string, unknown> = {}) {
    const submitted = await app.http.post('/api/v1/employee-archives').set(headers())
      .send(newEmployee(name, extra)).expect(201);
    await approve(submitted.body.data.id);
    const change = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: submitted.body.data.id } });
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: change.userId! } });
    return { user, requestId: change.id };
  }

  function noSensitiveStorage(value: unknown) {
    const response = JSON.stringify(value);
    for (const key of ['passwordHash', 'idNumberEncrypted', 'idNumberFingerprint', 'bankAccountEncrypted', 'bankAccountFingerprint']) {
      expect(response).not.toContain(`"${key}"`);
    }
  }

  it('saves the actual blank-controls draft body, resumes sensitive data, and self-approves without duplicate people', async () => {
    const saved = await app.http.post('/api/v1/employee-archives/drafts').set(headers()).send({
      name: `虚拟姓名草稿-${runId}`, deptId: '', entryDate: '', effectiveFrom: '',
      employee: { plannedRegularDate: '', actualRegularDate: '', leaveDate: '' },
      profile: { birthDate: '', graduationDate: '', socialSecurityStartDate: '', housingFundStartDate: '', bankAccount: 'synthetic-bank-draft' },
      draftStep: 2, draftLayoutVersion: 2,
    }).expect(201);
    const draftId = saved.body.data.id;
    expect(saved.body.data.recordStatus).toBe('draft');
    expect(saved.body.data.proposedValue.draftMeta.currentStep).toBe(2);
    noSensitiveStorage(saved.body);
    const before = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: draftId } });
    const encrypted = (before.proposedValue as any).profile.bankAccountEncrypted;
    expect(encrypted).toBeTruthy();

    const resumed = await app.http.post('/api/v1/employee-archives/drafts').set(headers()).send({
      draftId, name: saved.body.data.employeeName, profile: { bankAccount: '' }, draftStep: 3,
    }).expect(201);
    expect(resumed.body.data.id).toBe(draftId);
    expect((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: draftId } })).proposedValue)
      .toMatchObject({ profile: { bankAccountEncrypted: encrypted } });

    const submitted = await app.http.post('/api/v1/employee-archives').set(headers())
      .send(newEmployee(saved.body.data.employeeName, { draftId })).expect(201);
    expect(submitted.body.data.id).toBe(draftId);
    expect(submitted.body.data.employeeNo).toMatch(/^\d+$/);
    await approve(draftId);
    const request = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: draftId } });
    expect(request.createdById).toBe(adminId);
    expect(request.profileReviewedById).toBe(adminId);
    expect(await app.prisma.user.count({ where: { name: saved.body.data.employeeName } })).toBe(1);
    const archive = await app.http.get(`/api/v1/employee-archives/${request.userId}`).set(headers()).expect(200);
    noSensitiveStorage(archive.body);
    expect(archive.body.data.employeeProfile.bankAccountConfigured).toBe(true);
  });

  it('allows a rejected new-hire application to resume and reuse its reserved number', async () => {
    const payload = newEmployee(`虚拟退回重提-${runId}`);
    const first = await app.http.post('/api/v1/employee-archives').set(headers()).send(payload).expect(201);
    const id = first.body.data.id;
    await app.http.post('/api/v1/employee-archives/reviews/reject').set(headers())
      .send({ requestIds: [id], reason: '补充任职信息' }).expect(201);
    const applications = await app.http.get('/api/v1/employee-archives/applications/list').set(headers()).expect(200);
    expect(JSON.stringify(applications.body.data)).toContain(id);
    const resubmitted = await app.http.post('/api/v1/employee-archives').set(headers())
      .send({ ...payload, draftId: id, employee: { position: '虚拟更正岗位' } }).expect(201);
    expect(resubmitted.body.data.id).toBe(id);
    expect(resubmitted.body.data.employeeNo).toBe(first.body.data.employeeNo);
    expect(resubmitted.body.data.requestVersion).toBeGreaterThan(first.body.data.requestVersion);
    await approve(id);
    expect(await app.prisma.user.count({ where: { name: payload.name } })).toBe(1);
  });

  it('preserves a sensitive replacement while an ordinary archive draft is resumed without plaintext', async () => {
    const { user } = await createFormalEmployee(`虚拟敏感续填-${runId}`, { profile: { bankAccount: 'synthetic-bank-old' } });
    const saved = await app.http.patch(`/api/v1/employee-archives/${user.id}/draft/save`).set(headers())
      .send({ employee: {}, profile: { bankAccount: 'synthetic-bank-new' } }).expect(200);
    const draftId = saved.body.data.id;
    const cipher = ((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: draftId } })).proposedValue as any)
      .profile.bankAccountEncrypted;
    const originalCipher = (await app.prisma.employeeProfile.findUniqueOrThrow({ where: { userId: user.id } })).bankAccountEncrypted;
    expect(cipher).not.toBe(originalCipher);
    const resumed = await app.http.patch(`/api/v1/employee-archives/${user.id}/draft/save`).set(headers())
      .send({ draftId, employee: {}, profile: { bankAccount: '' } }).expect(200);
    noSensitiveStorage(resumed.body);
    expect(((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: draftId } })).proposedValue as any)
      .profile.bankAccountEncrypted).toEqual(cipher);
    await app.http.patch(`/api/v1/employee-archives/${user.id}/draft`).set(headers())
      .send({ draftId, employee: {}, profile: { bankAccount: '' } }).expect(200);
    await approve(draftId);
    const appliedCipher = (await app.prisma.employeeProfile.findUniqueOrThrow({ where: { userId: user.id } })).bankAccountEncrypted;
    expect(appliedCipher && Array.from(appliedCipher)).toEqual(cipher.data);
  });

  it('archives and restores a name-only draft without creating a formal employee', async () => {
    const name = `虚拟草稿归档-${runId}`;
    const draft = await app.http.post('/api/v1/employee-archives/drafts').set(headers()).send({ name }).expect(201);
    const id = draft.body.data.id;
    await app.http.post('/api/v1/employee-archives/drafts/archive').set(headers()).send({ ids: [id] }).expect(201);
    expect((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id } })).recordStatus).toBe('archived');
    await app.http.post('/api/v1/employee-archives/drafts/restore').set(headers()).send({ ids: [id] }).expect(201);
    expect((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id } })).recordStatus).toBe('draft');
    await app.http.post('/api/v1/employee-archives/drafts').set(headers()).send({ draftId: id, name, draftStep: 1 }).expect(201);
    expect(await app.prisma.user.count({ where: { name } })).toBe(0);
  });

  it('keeps the last working day usable, revokes old sessions at Shanghai midnight, and reenters one identity with a new number', async () => {
    const { user } = await createFormalEmployee(`虚拟入离职-${runId}`);
    const originalNo = user.employeeNo;
    const originalToken = (await app.app.get(AuthService).issueToken(user)).token;
    const binding = await app.prisma.externalIdentityBinding.create({ data: {
      userId: user.id, provider: 'dingtalk', externalUnionId: `virtual-union-${runId}`,
      status: 'enabled', boundById: adminId,
    } });
    const leave = await app.http.post(`/api/v1/employee-archives/${user.id}/employments`).set(headers()).send({
      company: 'fuede', deptId, position: '虚拟岗位', employmentType: 'full_time', employeeStatus: 'resigned',
      effectiveFrom: '2035-03-20', leaveDate: '2035-03-20', changeType: 'resignation', reason: '虚拟验收离职',
    }).expect(201);
    await approve(leave.body.data.id);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('active');
    expect((await app.prisma.externalIdentityBinding.findUniqueOrThrow({ where: { id: binding.id } })).status).toBe('enabled');
    await app.http.get('/api/v1/auth/me').set('Authorization', `Bearer ${originalToken}`).expect(200);

    clock('2035-03-20T16:00:00.000Z');
    const oldClaims = JSON.parse(Buffer.from(originalToken.split('.')[1], 'base64url').toString('utf8'));
    expect(oldClaims.exp * 1000).toBeGreaterThan(Date.now());
    await app.http.get('/api/v1/auth/me').set('Authorization', `Bearer ${originalToken}`).expect(401);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('resigned');
    expect((await app.prisma.externalIdentityBinding.findUniqueOrThrow({ where: { id: binding.id } })).status).toBe('disabled');
    // Both tokens are still within their lifetime; only the departed employee loses access.
    token = (await app.app.get(AuthService).issueToken(await app.prisma.user.findUniqueOrThrow({ where: { id: adminId } }))).token;
    await app.http.post('/api/v1/employee-archives/archive').set(headers()).send({ ids: [user.id] }).expect(201);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).archivedAt).not.toBeNull();
    await app.http.post('/api/v1/employee-archives/restore').set(headers()).send({ ids: [user.id] }).expect(201);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).archivedAt).toBeNull();
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('resigned');
    await app.http.get('/api/v1/auth/me').set('Authorization', `Bearer ${originalToken}`).expect(401);

    const reentry = await app.http.post(`/api/v1/employee-archives/${user.id}/reentry`).set(headers()).send({
      company: 'fuede', deptId, position: '虚拟新岗位', effectiveDate: '2035-03-21',
      employeeStatus: 'probation', employmentType: 'full_time',
    }).expect(201);
    expect(reentry.body.data.userId).toBe(user.id);
    expect(reentry.body.data.employeeNo).not.toBe(originalNo);
    await approve(reentry.body.data.id);
    const rehired = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(rehired).toMatchObject({ employeeNo: reentry.body.data.employeeNo, status: 'probation', sysRole: 'employee', hrCapabilities: [] });
    const newToken = (await app.app.get(AuthService).issueToken(rehired)).token;
    await app.http.get('/api/v1/auth/me').set('Authorization', `Bearer ${newToken}`).expect(200);
    await app.http.get('/api/v1/auth/me').set('Authorization', `Bearer ${originalToken}`).expect(401);
    await app.http.post('/api/v1/auth/login').send({ employeeNo: originalNo, password: '0000' }).expect(401);
    await app.http.post('/api/v1/auth/login').send({ employeeNo: rehired.employeeNo, password: '0000' }).expect(200);
    expect(await app.prisma.user.count({ where: { name: user.name } })).toBe(1);
    const numbers = await app.prisma.employeeNumberAssignment.findMany({ where: { userId: user.id } });
    expect(numbers.map((item) => item.employeeNo)).toEqual(expect.arrayContaining([originalNo, rehired.employeeNo]));
    const archive = await app.http.get(`/api/v1/employee-archives/${user.id}`).set(headers()).expect(200);
    noSensitiveStorage(archive.body);
    expect(archive.body.data.employmentHistory.length).toBeGreaterThanOrEqual(3);
  });

  it('does not activate an unapproved performance relationship when only the base profile was approved', async () => {
    const { user: manager } = await createFormalEmployee(`虚拟上级-${runId}`);
    const submitted = await app.http.post('/api/v1/employee-archives').set(headers())
      .send(newEmployee(`虚拟分层审核-${runId}`, { performanceManagerId: manager.id })).expect(201);
    await approve(submitted.body.data.id, ['profile']);
    const request = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: submitted.body.data.id } });
    await app.app.get(EmployeeEffectiveDateService).refreshUserProjection(request.userId!);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: request.userId! } })).directManagerId).toBeNull();
    await approve(request.id, ['performance']);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: request.userId! } })).directManagerId).toBe(manager.id);
  });

  it('cancels an approved future resignation and remains active past the old departure boundary', async () => {
    const { user } = await createFormalEmployee(`虚拟取消未来离职-${runId}`);
    const originalEmployment = await app.prisma.employmentRecord.findFirstOrThrow({ where: { userId: user.id } });
    const departure = await app.http.post(`/api/v1/employee-archives/${user.id}/employments`).set(headers()).send({
      company: 'fuede', deptId, position: '虚拟岗位', employmentType: 'full_time', employeeStatus: 'resigned',
      effectiveFrom: '2035-03-25', leaveDate: '2035-03-25', changeType: 'resignation', reason: '虚拟未来离职',
    }).expect(201);
    const requestId = departure.body.data.id;
    await approve(requestId);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('active');
    const inProgress = await app.http.get('/api/v1/employee-archives/applications/list')
      .query({ keyword: user.name }).set(headers()).expect(200);
    expect(JSON.stringify(inProgress.body.data)).toContain(requestId);
    expect((await app.prisma.employmentRecord.findUniqueOrThrow({ where: { id: originalEmployment.id } })).effectiveTo)
      .toEqual(new Date('2035-03-25T00:00:00.000Z'));
    await app.http.post(`/api/v1/employee-archives/applications/${requestId}/cancel`).set(headers())
      .send({ reason: '虚拟撤销离职，继续在职' }).expect(201);
    const cancelled = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect((await app.prisma.employmentRecord.findUniqueOrThrow({ where: { id: originalEmployment.id } })).effectiveTo).toBeNull();
    clock('2035-03-26T16:00:00.000Z');
    const login = await app.http.post('/api/v1/auth/login')
      .send({ employeeNo: user.employeeNo, password: '0000' }).expect(200);
    expect(login.body.data.user.status).toBe('active');
    await app.http.get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.data.token}`).expect(200);
  });

  it('resubmits only a rejected performance relationship on the original base-approved new-hire application', async () => {
    const { user: manager } = await createFormalEmployee(`虚拟退回关系上级-${runId}`);
    const name = `虚拟分层退回重提-${runId}`;
    const submitted = await app.http.post('/api/v1/employee-archives').set(headers())
      .send(newEmployee(name, { performanceManagerId: manager.id })).expect(201);
    const requestId = submitted.body.data.id;
    await approve(requestId, ['profile']);
    const baseApproved = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(baseApproved.userId).not.toBeNull();
    const userId = baseApproved.userId!;
    const originalEmployeeNo = (await app.prisma.user.findUniqueOrThrow({ where: { id: userId } })).employeeNo;
    const originalEmploymentIds = (await app.prisma.employmentRecord.findMany({ where: { userId } })).map((item) => item.id);
    await app.http.post('/api/v1/employee-archives/reviews/reject').set(headers())
      .send({ requestIds: [requestId], reason: '请确认绩效关系后重新提交' }).expect(201);
    const resubmitted = await app.http.patch(`/api/v1/employee-archives/reentry/${requestId}`).set(headers())
      .send({ performanceOnly: true, performanceManagerId: manager.id }).expect(200);
    expect(resubmitted.body.data.id).toBe(requestId);
    const pending = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(pending.profileReviewStatus).toBe('approved');
    expect(pending.performanceReviewStatus).toBe('pending');
    expect(pending.employeeNo).toBe(originalEmployeeNo);
    expect(pending.requestVersion).toBeGreaterThan(baseApproved.requestVersion);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: userId } })).directManagerId).toBeNull();
    expect((await app.prisma.employmentRecord.findMany({ where: { userId } })).map((item) => item.id)).toEqual(originalEmploymentIds);
    await approve(requestId);
    const approved = await app.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(approved.employeeNo).toBe(originalEmployeeNo);
    expect(approved.directManagerId).toBe(manager.id);
    expect(await app.prisma.user.count({ where: { name } })).toBe(1);
  });

  it('rolls back the same approval action when its performance scope cannot be applied', async () => {
    const name = `虚拟原子审核-${runId}`;
    const submitted = await app.http.post('/api/v1/employee-archives').set(headers())
      .send(newEmployee(name, { performanceManagerId: randomUUID() })).expect(201);
    const requestId = submitted.body.data.id;
    const result = await app.http.post('/api/v1/employee-archives/reviews/approve').set(headers())
      .send({ requestIds: [requestId], scopes: ['profile', 'performance'] }).expect(201);
    expect(result.body.data.succeeded).toEqual([]);
    expect(result.body.data.failed).toEqual([expect.objectContaining({ requestId })]);
    expect(await app.prisma.user.count({ where: { name } })).toBe(0);
    const pending = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(pending.userId).toBeNull();
    expect(pending.profileReviewStatus).toBe('pending');
  });

  it('keeps edit/review permissions separate and honors revocation even for an already signed session', async () => {
    const ordinaryHr = await app.prisma.user.create({ data: {
      name: `虚拟普通HR-${runId}`, employeeNo: `TEST-EDITOR-${runId}`, accountType: 'service',
      status: 'active', sysRole: 'hr_user', deptId, hrCapabilities: ['employee_archive_edit'],
    } });
    const editorToken = (await app.app.get(AuthService).issueToken(ordinaryHr)).token;
    const editorHeader = { Authorization: `Bearer ${editorToken}` };
    await app.http.get('/api/v1/employee-archives/applications/list').set(editorHeader).expect(200);
    await app.http.post('/api/v1/employee-archives/drafts').set(editorHeader).send({ name: `虚拟普通HR草稿-${runId}` }).expect(201);
    await app.http.post('/api/v1/employee-archives/reviews/approve').set(editorHeader)
      .send({ requestIds: [randomUUID()], scopes: ['profile'] }).expect(403);
    await app.prisma.user.update({ where: { id: ordinaryHr.id }, data: { hrCapabilities: { set: [] } } });
    await app.http.get('/api/v1/employee-archives/applications/list').set(editorHeader).expect(403);
  });

  it('revises an approved future reentry without activating the obsolete date or job, then preserves cancellation history', async () => {
    const { user } = await createFormalEmployee(`虚拟未来再入职-${runId}`);
    const leave = await app.http.post(`/api/v1/employee-archives/${user.id}/employments`).set(headers()).send({
      company: 'fuede', deptId, position: '虚拟岗位', employmentType: 'full_time', employeeStatus: 'resigned',
      effectiveFrom: '2035-03-18', leaveDate: '2035-03-18', changeType: 'resignation', reason: '虚拟补录离职',
    }).expect(201);
    await approve(leave.body.data.id);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('resigned');
    const proposal = {
      company: 'fuede', deptId, position: '虚拟旧待入职岗位', effectiveDate: '2035-03-25',
      employeeStatus: 'probation', employmentType: 'full_time',
    };
    const reentry = await app.http.post(`/api/v1/employee-archives/${user.id}/reentry`).set(headers()).send(proposal).expect(201);
    const requestId = reentry.body.data.id;
    await approve(requestId);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('pending_entry');
    await app.http.patch(`/api/v1/employee-archives/reentry/${requestId}`).set(headers())
      .send({ ...proposal, effectiveDate: '2035-03-28', position: '虚拟新待入职岗位' }).expect(200);
    expect(await app.prisma.employmentRecord.count({ where: { sourceRequestId: requestId } })).toBe(0);
    clock('2035-03-24T16:00:00.000Z');
    await app.app.get(EmployeeEffectiveDateService).refreshUserProjection(user.id);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('resigned');
    token = (await app.app.get(AuthService).issueToken(await app.prisma.user.findUniqueOrThrow({ where: { id: adminId } }))).token;
    await approve(requestId);
    const newScheduled = await app.prisma.employmentRecord.findUniqueOrThrow({ where: { sourceRequestId: requestId } });
    expect(newScheduled.effectiveFrom.toISOString().slice(0, 10)).toBe('2035-03-28');
    expect(newScheduled.position).toBe('虚拟新待入职岗位');
    await app.http.post(`/api/v1/employee-archives/reentry/${requestId}/cancel`).set(headers())
      .send({ reason: '虚拟取消验收' }).expect(201);
    const cancelled = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(cancelled.onboardingStatus).toBe('cancelled');
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(await app.prisma.employmentRecord.count({ where: { sourceRequestId: requestId } })).toBe(0);
    const restored = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(restored.status).toBe('resigned');
    expect(restored.employeeNo).toBe(user.employeeNo);
    const reserved = await app.prisma.employeeNumberAssignment.findFirstOrThrow({ where: { sourceRequestId: requestId } });
    expect(reserved.status).toBe('released');
  });
});

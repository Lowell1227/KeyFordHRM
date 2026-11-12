import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuthService } from '@/auth/auth.service';
import { EmployeeEffectiveDateService } from '@/employee-archives/employee-effective-date.service';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Personnel daily flow with real JWT, HTTP and disposable PostgreSQL', () => {
  let app: TestApp;
  let deptId: string;
  let reviewerId: string;
  let editor: string;
  let reviewer: string;
  let employee: string;
  let plainHr: string;
  let admin: string;
  let orgEditor: string;
  const runId = randomUUID().slice(0, 8);
  const root = '/api/v1/employee-archives';
  const headers = (token = editor) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL ?? '');
    const redis = new URL(process.env.REDIS_URL ?? '');
    if (!['postgres:', 'postgresql:'].includes(db.protocol)
      || db.hostname !== '127.0.0.1' || db.pathname !== '/hrm_personnel_daily_test'
      || redis.protocol !== 'redis:' || redis.hostname !== '127.0.0.1'
      || !process.env.PERSONNEL_DAILY_TEST_RUN_ID
      || db.port === '5432' || redis.port === '6379') {
      throw new Error('Requires explicitly provisioned disposable loopback personnel database and Redis');
    }
    process.env.JWT_SECRET = randomUUID();
    process.env.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY = randomUUID();
    process.env.ENABLE_TEST_QUICK_LOGIN = 'false';
    process.env.DINGTALK_NOTIFICATION_ENABLED = 'false';
    process.env.DINGTALK_BOT_STREAM_ENABLED = 'false';
    process.env.DINGTALK_BOT_PREFLIGHT_CONFIRMED = 'false';
    jest.useFakeTimers({ now: new Date('2035-03-20T04:00:00.000Z'), doNotFake: [
      'nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
      'setInterval', 'clearInterval', 'queueMicrotask', 'performance', 'hrtime',
    ] });
    app = await buildTestApp();
    app.app.get(SchedulerRegistry).getCronJobs().forEach(job => job.stop());
    expect(await app.prisma.user.count()).toBe(0);
    deptId = (await app.prisma.department.create({ data: { name: `虚拟档案验收部门-${runId}` } })).id;
    async function actor(sysRole: 'hr_user' | 'employee' | 'system_admin', hrCapabilities: string[]) {
      const user = await app.prisma.user.create({ data: {
        name: `虚拟验收身份-${randomUUID().slice(0, 8)}`, employeeNo: `ACT-${randomUUID().slice(0, 8)}`,
        accountType: 'service', status: 'active', sysRole, hrCapabilities,
      } });
      return { user, token: (await app.app.get(AuthService).issueToken(user)).token };
    }
    editor = (await actor('hr_user', ['employee_archive_edit'])).token;
    const reviewActor = await actor('hr_user', ['employee_archive_review']);
    reviewer = reviewActor.token;
    reviewerId = reviewActor.user.id;
    employee = (await actor('employee', ['employee_archive_review'])).token;
    plainHr = (await actor('hr_user', [])).token;
    admin = (await actor('system_admin', [])).token;
    orgEditor = (await actor('hr_user', ['organization_edit'])).token;
    if (process.env.PERSONNEL_DAILY_WEB_URL) await app.app.listen(3307, '127.0.0.1');
  });
  afterAll(async () => {
    if (app) await closeTestApp(app);
    jest.useRealTimers();
  });

  async function fixture(directoryFamily: string | null = null, missingDepartment = false) {
    const position = await app.prisma.position.create({ data: {
      code: `POS-${randomUUID().slice(0, 8)}`, name: '虚拟目录岗位', jobFamily: directoryFamily,
    } });
    const user = await app.prisma.user.create({ data: {
      name: `虚拟档案员工-${randomUUID().slice(0, 8)}`, employeeNo: `EMP-${randomUUID().slice(0, 8)}`,
      deptId: missingDepartment ? null : deptId, positionId: position.id, position: position.name,
      entryDate: new Date('2035-03-01'), status: 'active', accountType: 'employee',
    } });
    await app.prisma.employmentRecord.create({ data: {
      userId: user.id, employeeNo: user.employeeNo, company: 'fuede', deptId: user.deptId,
      positionId: position.id, position: position.name, jobFamily: '虚拟档案原职系', jobGrade: 'P3',
      workLocation: '虚拟原地点', effectiveFrom: new Date('2035-03-01'), entryDate: user.entryDate,
      employmentType: 'full_time', employeeStatus: 'active', changeType: 'hire',
    } });
    return { user, position };
  }
  async function archive(id: string) {
    return (await app.http.get(`${root}/${id}`).set(headers()).expect(200)).body.data;
  }
  async function submit(id: string, changes: Record<string, unknown>, performance?: Record<string, unknown>) {
    const current = await archive(id);
    return (await app.http.patch(`${root}/${id}/draft`).set(headers()).send({
      baseVersion: current.archiveVersion, employee: changes, profile: {}, performance,
    }).expect(200)).body.data.request;
  }
  async function approve(id: string) {
    const response = await app.http.post(`${root}/reviews/approve`).set(headers(reviewer))
      .send({ requestIds: [id], scopes: ['profile'] }).expect(201);
    expect(response.body.data.failed).toEqual([]);
    expect(response.body.data.succeeded).toEqual([expect.objectContaining({ requestId: id })]);
  }

  it.each([null, '虚拟目录其他职系'])('preserves the family through submit, approval, DB and continued editing (directory=%s)', async directoryFamily => {
    const { user, position } = await fixture(directoryFamily);
    const { user: manager } = await fixture();
    const request = await submit(user.id, { workLocation: '虚拟新地点' }, { managerId: manager.id });
    expect(request.proposedValue.employee.jobFamily).toBe('虚拟档案原职系');
    await approve(request.id);
    expect((await archive(user.id)).currentEmployment).toMatchObject({
      positionId: position.id, position: position.name, jobFamily: '虚拟档案原职系', workLocation: '虚拟新地点',
    });
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { sourceRequestId: request.id } }))
      .toMatchObject({ jobFamily: '虚拟档案原职系', workLocation: '虚拟新地点' });
    await app.http.post(`${root}/reviews/reject`).set(headers(reviewer))
      .send({ requestIds: [request.id], reason: '虚拟复核绩效关系' }).expect(201);
    // Resubmit the returned relationship on the same base-approved application.
    const partial = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(partial.profileReviewStatus).toBe('approved');
    expect(partial.performanceReviewStatus).toBe('rejected');
    const continued = await app.http.patch(`${root}/${user.id}/draft`).set(headers()).send({
      draftId: request.id, expectedVersion: partial.requestVersion,
      employee: { workLocation: '虚拟新地点' }, profile: {}, performance: { managerId: manager.id },
    }).expect(200);
    expect(continued.body.data.request.proposedValue.employee.jobFamily).toBe('虚拟档案原职系');
    expect(continued.body.data.request.profileReviewStatus).toBe('approved');
    expect(continued.body.data.request.performanceReviewStatus).toBe('pending');
  });

  it.each([null, '虚拟人工修订职系'])('applies an explicitly reviewed family with the same position (%s)', async jobFamily => {
    const { user } = await fixture('虚拟目录职系');
    const request = await submit(user.id, { jobFamily, workLocation: '虚拟新地点' });
    await approve(request.id);
    expect((await archive(user.id)).currentEmployment.jobFamily).toBe(jobFamily);
  });

  it.each([null, '虚拟新目录职系'])('still follows directory family on an actual position change (%s)', async jobFamily => {
    const { user } = await fixture();
    const position = await app.prisma.position.create({ data: {
      code: `POS-${randomUUID().slice(0, 8)}`, name: '虚拟新岗位', jobFamily,
    } });
    const request = await submit(user.id, { positionId: position.id, jobFamily: '不采纳的手填值' });
    await approve(request.id);
    expect((await archive(user.id)).currentEmployment).toMatchObject({ positionId: position.id, jobFamily });
  });

  it.each([null, '虚拟目录其他职系'])('retains omitted family and grade in a same-position departure request (directory=%s)', async directoryFamily => {
    const { user, position } = await fixture(directoryFamily);
    const request = (await app.http.post(`${root}/${user.id}/employments`).set(headers()).send({
      company: 'fuede', deptId, positionId: position.id,
      employmentType: 'full_time', employeeStatus: 'resigned', changeType: 'resignation',
      effectiveFrom: '2035-03-20', leaveDate: '2035-03-20', reason: '虚拟离职申请省略职系职等',
    }).expect(201)).body.data;
    expect(request.proposedValue.employee).toMatchObject({ jobFamily: '虚拟档案原职系', jobGrade: 'P3' });
    await approve(request.id);
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { sourceRequestId: request.id } }))
      .toMatchObject({ jobFamily: '虚拟档案原职系', jobGrade: 'P3' });
  });

  it('retains an uncatalogued position label when departure does not change the position', async () => {
    const { user } = await fixture();
    await app.prisma.user.update({ where: { id: user.id }, data: { positionId: null, position: '虚拟历史文字岗位' } });
    await app.prisma.employmentRecord.updateMany({ where: { userId: user.id }, data: { positionId: null, position: '虚拟历史文字岗位' } });
    const request = (await app.http.post(`${root}/${user.id}/employments`).set(headers()).send({
      company: 'fuede', deptId, positionId: null,
      employmentType: 'full_time', employeeStatus: 'resigned', changeType: 'resignation',
      effectiveFrom: '2035-03-20', leaveDate: '2035-03-20', reason: '虚拟文字岗位离职',
    }).expect(201)).body.data;
    expect(request.proposedValue.employee.position).toBe('虚拟历史文字岗位');
    await approve(request.id);
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { sourceRequestId: request.id } }))
      .toMatchObject({ position: '虚拟历史文字岗位', jobFamily: '虚拟档案原职系', jobGrade: 'P3' });
  });

  it.each([null, '虚拟明确修订职系'])('honors an explicit family and grade change on a same-position employment request (%s)', async jobFamily => {
    const { user, position } = await fixture('虚拟目录职系');
    const request = (await app.http.post(`${root}/${user.id}/employments`).set(headers()).send({
      company: 'fuede', deptId, positionId: position.id, jobFamily, jobGrade: null,
      employmentType: 'full_time', employeeStatus: 'active', changeType: 'transfer',
      effectiveFrom: '2035-03-20', reason: '虚拟明确修订',
    }).expect(201)).body.data;
    expect(request.proposedValue.employee).toMatchObject({ jobFamily, jobGrade: null });
    await approve(request.id);
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { sourceRequestId: request.id } }))
      .toMatchObject({ jobFamily, jobGrade: null });
  });

  it.each([null, '虚拟新目录职系'])('derives family for an actual employment position change (%s)', async jobFamily => {
    const { user } = await fixture();
    const position = await app.prisma.position.create({ data: {
      code: `POS-${randomUUID().slice(0, 8)}`, name: '虚拟任职新岗位', jobFamily,
    } });
    const request = (await app.http.post(`${root}/${user.id}/employments`).set(headers()).send({
      company: 'fuede', deptId, positionId: position.id, jobFamily: '不采纳的手填值',
      employmentType: 'full_time', employeeStatus: 'active', changeType: 'transfer',
      effectiveFrom: '2035-03-20', reason: '虚拟换岗',
    }).expect(201)).body.data;
    expect(request.proposedValue.employee).toMatchObject({ positionId: position.id, jobFamily, jobGrade: 'P3' });
    await approve(request.id);
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { sourceRequestId: request.id } }))
      .toMatchObject({ positionId: position.id, jobFamily, jobGrade: 'P3' });
  });

  it('still clears position and family when an employment request explicitly removes the catalogue position', async () => {
    const { user } = await fixture();
    const request = (await app.http.post(`${root}/${user.id}/employments`).set(headers()).send({
      company: 'fuede', deptId, positionId: null,
      employmentType: 'full_time', employeeStatus: 'active', changeType: 'transfer',
      effectiveFrom: '2035-03-20', reason: '虚拟清除岗位关联',
    }).expect(201)).body.data;
    expect(request.proposedValue.employee).toMatchObject({ positionId: null, position: null, jobFamily: null });
    await approve(request.id);
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { sourceRequestId: request.id } }))
      .toMatchObject({ positionId: null, position: null, jobFamily: null });
  });

  it('uses persisted review capability, retains edit restrictions and records a return audit', async () => {
    const { user } = await fixture();
    const request = await submit(user.id, { workLocation: '虚拟待补地点' });
    await app.http.post(`${root}/reviews/reject`).send({ requestIds: [request.id], reason: '虚拟补资料' }).expect(401);
    for (const token of [editor, employee, plainHr]) {
      await app.http.post(`${root}/reviews/reject`).set(headers(token))
        .send({ requestIds: [request.id], reason: '虚拟补资料' }).expect(403);
    }
    await app.http.patch(`${root}/${user.id}/profile`).set(headers(reviewer)).send({}).expect(403);
    const result = await app.http.post(`${root}/reviews/reject`).set(headers(reviewer))
      .send({ requestIds: [request.id], reason: '虚拟补资料' }).expect(201);
    expect(result.body.data.failed).toEqual([]);
    expect(result.body.data.succeeded).toHaveLength(1);
    expect(await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .toMatchObject({ profileReviewStatus: 'rejected', profileReviewedById: reviewerId, rejectedReason: '虚拟补资料' });
    expect(await app.prisma.auditLog.findFirst({ where: { entityId: request.id, action: 'reject_employee_data_change' } }))
      .toMatchObject({ userId: reviewerId, newValue: { reason: '虚拟补资料' } });
    expect((await archive(user.id)).currentEmployment.workLocation).toBe('虚拟原地点');
  });

  it('keeps a department draft out of the formal archive, then approves the department before departure', async () => {
    const { user, position } = await fixture(null, true);
    const departure = {
      company: 'fuede', positionId: position.id,
      employmentType: 'full_time', employeeStatus: 'resigned', changeType: 'resignation',
      effectiveFrom: '2035-03-20', leaveDate: '2035-03-20', reason: '虚拟保留的离职原因',
    };
    const before = await archive(user.id);
    const saved = (await app.http.patch(`${root}/${user.id}/draft/save`).set(headers()).send({
      baseVersion: before.archiveVersion, employee: { deptId }, profile: {},
    }).expect(200)).body.data;
    expect((await archive(user.id)).currentEmployment.deptId).toBeNull();
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deptId).toBeNull();
    // A draft cannot satisfy departure review's existing required-department rule.
    const blocked = (await app.http.post(`${root}/${user.id}/employments`).set(headers())
      .send(departure).expect(201)).body.data;
    const failed = await app.http.post(`${root}/reviews/approve`).set(headers(reviewer))
      .send({ requestIds: [blocked.id], scopes: ['profile'] }).expect(201);
    expect(failed.body.data.failed).toEqual([expect.objectContaining({ reason: '所属部门不能为空' })]);
    await app.http.post(`${root}/reviews/reject`).set(headers(reviewer))
      .send({ requestIds: [blocked.id], reason: '虚拟先补部门' }).expect(201);
    const submitted = (await app.http.patch(`${root}/${user.id}/draft`).set(headers()).send({
      draftId: saved.id, expectedVersion: saved.requestVersion, employee: { deptId }, profile: {},
    }).expect(200)).body.data;
    expect((await archive(user.id)).currentEmployment.deptId).toBeNull();
    await approve(submitted.request.id);
    expect((await archive(user.id)).currentEmployment.deptId).toBe(deptId);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deptId).toBe(deptId);
    const leave = (await app.http.post(`${root}/${user.id}/employments`).set(headers())
      .send({ ...departure, deptId }).expect(201)).body.data;
    expect(leave.proposedValue.employee.reason).toBe(departure.reason);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('active');
    await approve(leave.id);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('active');
    await app.app.get(EmployeeEffectiveDateService).refreshUserProjection(user.id, new Date('2035-03-21T04:00:00Z'));
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .toMatchObject({ deptId, status: 'resigned', leaveDate: new Date('2035-03-20') });
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { sourceRequestId: leave.id } }))
      .toMatchObject({ deptId, reason: departure.reason, employeeStatus: 'resigned', leaveDate: new Date('2035-03-20') });
    expect((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: leave.id } })).proposedValue)
      .toMatchObject({ employee: { reason: departure.reason } });
  });

  it('submits an autosaved exempt-field draft once and reloads the new formal value', async () => {
    const { user } = await fixture();
    const before = await archive(user.id);
    const input = { baseVersion: before.archiveVersion, employee: {}, profile: { education: '虚拟硕士' } };
    const saved = (await app.http.patch(`${root}/${user.id}/draft/save`).set(headers()).send(input).expect(200)).body.data;
    expect((await archive(user.id)).employeeProfile?.education).not.toBe('虚拟硕士');
    const result = (await app.http.patch(`${root}/${user.id}/draft`).set(headers()).send({
      ...input, draftId: saved.id, expectedVersion: saved.requestVersion,
    }).expect(200)).body.data;
    expect(result).toMatchObject({ request: null, reviewOutcome: 'not_required', directApplied: ['学历'] });
    expect((await archive(user.id)).employeeProfile.education).toBe('虚拟硕士');
    expect((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: saved.id } })).archivedAt).not.toBeNull();
  });

  it('rebases a pending legacy review so approving it cannot overwrite an exempt edit', async () => {
    const { user } = await fixture();
    const pending = (await app.http.patch(`${root}/${user.id}/profile`).set(headers())
      .send({ gender: '女' }).expect(200)).body.data;
    const before = await archive(user.id);
    await app.http.patch(`${root}/${user.id}/draft`).set(headers()).send({
      baseVersion: before.archiveVersion, employee: {}, profile: { education: '虚拟本科' },
    }).expect(200);
    const rebased = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(rebased.requestVersion).toBe(pending.requestVersion + 1);
    expect(rebased.proposedValue).toMatchObject({ profile: { education: '虚拟本科', gender: '女' } });
    expect(rebased.revisionHistory).toEqual(expect.arrayContaining([expect.objectContaining({ version: pending.requestVersion })]));
    await approve(pending.id);
    expect((await archive(user.id)).employeeProfile).toMatchObject({ education: '虚拟本科', gender: '女' });
  });

  it('rolls back formal changes when a pending proposal conflicts and rejects impossible dates', async () => {
    const { user } = await fixture();
    await app.http.patch(`${root}/${user.id}/profile`).set(headers()).send({ gender: '女' }).expect(200);
    const before = await archive(user.id);
    await app.http.patch(`${root}/${user.id}/draft`).set(headers()).send({
      baseVersion: before.archiveVersion, employee: {}, profile: { gender: '男', education: '不得写入' },
    }).expect(409);
    expect((await archive(user.id)).employeeProfile).toBeNull();
    await app.http.patch(`${root}/${user.id}/draft`).set(headers()).send({
      baseVersion: before.archiveVersion, employee: {}, profile: { birthDate: '2035-02-31' },
    }).expect(400);
    expect(await app.prisma.auditLog.count({ where: { entityId: user.id, action: 'direct_update_employee_profile' } })).toBe(0);
  });

  it('only a system administrator can change review mode, and existing pending work stays pending', async () => {
    const url = '/api/v1/personnel-config/review-mode';
    await app.http.get(url).expect(401);
    expect((await app.http.get(url).set(headers()).expect(200)).body.data.mode).toBe('standard');
    for (const token of [editor, reviewer, employee, plainHr, orgEditor]) {
      await app.http.put(url).set(headers(token)).send({ mode: 'relaxed' }).expect(403);
    }
    await app.http.put(url).set(headers(admin)).send({ mode: 'invalid' }).expect(400);
    const { user } = await fixture();
    const pending = await submit(user.id, { name: '虚拟待审姓名' });
    await app.http.put(url).set(headers(admin)).send({ mode: 'relaxed' }).expect(200);
    expect((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: pending.id } })).profileReviewStatus).toBe('pending');
    expect(await app.prisma.auditLog.findFirst({ where: { action: 'update_personnel_review_mode' } }))
      .toMatchObject({ oldValue: { mode: 'standard' }, newValue: { key: 'personnel_review_mode', mode: 'relaxed' } });
  });

  it('relaxed mode uses the real review service and leaves edit-only users unable to approve manually', async () => {
    const { user } = await fixture();
    const current = await archive(user.id);
    const result = (await app.http.patch(`${root}/${user.id}/draft`).set(headers()).send({
      baseVersion: current.archiveVersion, employee: { name: '虚拟自动审核员工' }, profile: {},
    }).expect(200)).body.data;
    expect(result.reviewOutcome).toBe('approved');
    expect((await archive(user.id)).name).toBe('虚拟自动审核员工');
    expect((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: result.request.id } })).profileReviewStatus).toBe('approved');
    expect((await app.prisma.auditLog.findFirst({ where: { entityId: result.request.id, action: 'approve_employee_data_change' } }))?.newValue)
      .toMatchObject({ autoApproved: true });
    await app.http.post(`${root}/reviews/approve`).set(headers()).send({ requestIds: [result.request.id], scopes: ['profile'] }).expect(403);
    await app.http.patch(`${root}/${user.id}/draft`).set(headers(employee)).send({ employee: {}, profile: {} }).expect(403);
  });

  it('auto-approves departments and positions, but validation failures remain pending', async () => {
    const dept = (await app.http.post('/api/v1/departments').set(headers(orgEditor))
      .send({ name: `虚拟自动部门-${runId}`, company: 'fuede' }).expect(201)).body.data;
    expect(dept.status).toBe('approved');
    expect(await app.prisma.department.findFirst({ where: { name: `虚拟自动部门-${runId}` } })).not.toBeNull();
    const position = (await app.http.post('/api/v1/positions').set(headers(orgEditor))
      .send({ name: '虚拟自动岗位', code: `AUTO-${runId}` }).expect(201)).body.data;
    expect(position.status).toBe('approved');
    const failed = (await app.http.delete(`/api/v1/departments/${deptId}`).set(headers(orgEditor)).expect(200)).body.data;
    expect(failed.status).toBe('pending');
    expect((await app.prisma.department.findUniqueOrThrow({ where: { id: deptId } })).isActive).toBe(true);
  });

  it('auto-approves future employment without prematurely changing current assignment', async () => {
    const { user, position } = await fixture();
    const target = await app.prisma.department.create({ data: { name: `虚拟未来部门-${runId}` } });
    const result = (await app.http.post(`${root}/${user.id}/employments`).set(headers()).send({
      company: 'fuede', deptId: target.id, positionId: position.id, employmentType: 'full_time',
      employeeStatus: 'active', changeType: 'transfer', effectiveFrom: '2035-04-01', reason: '虚拟未来调动',
    }).expect(201)).body.data;
    expect(result.reviewOutcome).toBe('approved');
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deptId).toBe(deptId);
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { sourceRequestId: result.id } }))
      .toMatchObject({ deptId: target.id, effectiveFrom: new Date('2035-04-01') });
  });

  it('keeps department merges pending even in relaxed mode', async () => {
    const source = await app.prisma.department.create({ data: { name: `虚拟合并来源-${runId}` } });
    const target = await app.prisma.department.create({ data: { name: `虚拟合并目标-${runId}` } });
    const result = (await app.http.post(`/api/v1/departments/${source.id}/merge`).set(headers(orgEditor))
      .send({ targetDepartmentId: target.id }).expect(201)).body.data;
    expect(result).toMatchObject({ status: 'pending', reviewOutcome: 'pending' });
    expect((await app.prisma.department.findUniqueOrThrow({ where: { id: source.id } })).isActive).toBe(true);
    expect(await app.prisma.auditLog.count({ where: { entityId: result.id, action: 'approve_department_change' } })).toBe(0);
  });

  it('auto-approves future onboarding but keeps it pending entry until its effective date', async () => {
    const result = (await app.http.post(root).set(headers()).send({
      name: `虚拟未来入职-${runId}`, company: 'fuede', deptId, entryDate: '2035-04-01',
      effectiveFrom: '2035-04-01', employmentType: 'full_time', employeeStatus: 'active',
    }).expect(201)).body.data;
    expect(result.reviewOutcome).toBe('approved');
    expect(await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: result.id } }))
      .toMatchObject({ profileReviewStatus: 'approved', onboardingStatus: 'pending_entry' });
    await app.http.put('/api/v1/personnel-config/review-mode').set(headers(admin)).send({ mode: 'standard' }).expect(200);
    const { user } = await fixture();
    const pending = await submit(user.id, { name: '虚拟恢复人工审核' });
    expect((await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: pending.id } })).profileReviewStatus).toBe('pending');
  });

  it('does not approve old profile changes when only a performance manager is resubmitted', async () => {
    await app.http.put('/api/v1/personnel-config/review-mode').set(headers(admin)).send({ mode: 'standard' }).expect(200);
    const { user } = await fixture();
    const firstManager = (await fixture()).user;
    const newManager = (await fixture()).user;
    const pending = await submit(user.id, { name: '虚拟旧待审姓名' }, { managerId: firstManager.id });
    await app.http.put('/api/v1/personnel-config/review-mode').set(headers(admin)).send({ mode: 'relaxed' }).expect(200);
    const result = (await app.http.post(`${root}/${user.id}/performance-manager-review`).set(headers())
      .send({ managerId: newManager.id }).expect(201)).body.data;
    expect(result).toMatchObject({ id: pending.id, reviewOutcome: 'approved' });
    expect(await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: pending.id } }))
      .toMatchObject({ profileReviewStatus: 'pending', performanceReviewStatus: 'approved' });
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .toMatchObject({ name: user.name, directManagerId: newManager.id });
    const audits = await app.prisma.auditLog.findMany({ where: { entityId: pending.id, action: 'approve_employee_data_change' } });
    expect(audits).toHaveLength(1);
    expect(audits[0].newValue).toMatchObject({ scopes: ['performance'], autoApproved: true });
    await app.http.put('/api/v1/personnel-config/review-mode').set(headers(admin)).send({ mode: 'standard' }).expect(200);
  });

  const webTest = process.env.PERSONNEL_DAILY_WEB_URL ? it : it.skip;
  webTest('real browser: PC/mobile autosave-submit-reload and administrator mode confirmation', async () => {
    const url = new URL(process.env.PERSONNEL_DAILY_WEB_URL!);
    if (url.hostname !== '127.0.0.1' || url.port !== '5187') throw new Error('Browser must use the isolated QA web server');
    const { chromium } = require('../../../web/node_modules/playwright');
    const { expect: browserExpect } = require('../../../web/node_modules/@playwright/test');
    const browser = await chromium.launch({ headless: true });
    try {
      for (const width of [1440, 1024, 390]) {
        const { user } = await fixture();
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
        await context.addInitScript((token: string) => localStorage.setItem('token', token), editor);
        const page = await context.newPage();
        await page.goto(`${url.origin}/users`);
        await page.getByPlaceholder('搜索姓名、当前工号或历史工号').fill(user.employeeNo);
        await page.getByPlaceholder('搜索姓名、当前工号或历史工号').press('Enter');
        await browserExpect(page.locator('button:visible').filter({ hasText: /^查看档案$/ })).toHaveCount(1);
        await page.locator('button:visible').filter({ hasText: /^查看档案$/ }).click();
        const drawer = page.locator('.employee-archive-drawer:visible');
        await drawer.getByRole('button', { name: '编辑档案', exact: true }).click();
        const saved = page.waitForResponse((response: any) => response.url().endsWith(`/${user.id}/draft/save`) && response.request().method() === 'PATCH');
        await drawer.locator('[data-archive-field="profile.education"] input').fill(`虚拟浏览器学历-${width}`);
        expect((await saved).status()).toBe(200);
        await browserExpect(drawer.getByRole('button', { name: '提交审核', exact: true })).toBeEnabled();
        const submitted = page.waitForResponse((response: any) => response.url().endsWith(`/${user.id}/draft`) && response.request().method() === 'PATCH');
        await drawer.getByRole('button', { name: '提交审核', exact: true }).click();
        expect((await submitted).status()).toBe(200);
        await browserExpect(drawer.getByRole('button', { name: '编辑档案', exact: true })).toBeVisible();
        await browserExpect(drawer.getByText(`虚拟浏览器学历-${width}`, { exact: true })).toBeVisible();
        expect((await archive(user.id)).employeeProfile.education).toBe(`虚拟浏览器学历-${width}`);
        const bounds = await drawer.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(-1);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: `${process.env.TEMP}/hrm-review-archive-${width}.png` });
        await context.close();
      }
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript((token: string) => localStorage.setItem('token', token), admin);
      const page = await context.newPage();
      await page.goto(`${url.origin}/system`);
      await browserExpect(page.getByText('当前：标准模式（人工审核）', { exact: true })).toBeVisible();
      await page.locator('.el-radio-button').filter({ hasText: /^宽松模式$/ }).click();
      await page.getByRole('button', { name: '保持标准模式', exact: true }).click();
      expect((await app.http.get('/api/v1/personnel-config/review-mode').set(headers()).expect(200)).body.data.mode).toBe('standard');
      await page.locator('.el-radio-button').filter({ hasText: /^宽松模式$/ }).click();
      await page.getByRole('button', { name: '开启宽松模式', exact: true }).click();
      await browserExpect(page.getByText('当前：宽松模式（系统自动审核）', { exact: true })).toBeVisible();
      await page.locator('.el-radio-button').filter({ hasText: /^标准模式$/ }).click();
      await browserExpect(page.getByText('当前：标准模式（人工审核）', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `${process.env.TEMP}/hrm-review-mode-mobile.png` });
      await context.close();
    } finally { await browser.close(); }
  }, 180000);
});

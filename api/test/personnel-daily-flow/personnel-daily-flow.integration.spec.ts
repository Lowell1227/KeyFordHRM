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
    async function actor(sysRole: 'hr_user' | 'employee', hrCapabilities: string[]) {
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
    }).expect(200)).body.data;
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
    expect(continued.body.data.proposedValue.employee.jobFamily).toBe('虚拟档案原职系');
    expect(continued.body.data.profileReviewStatus).toBe('approved');
    expect(continued.body.data.performanceReviewStatus).toBe('pending');
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
    await approve(submitted.id);
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
});

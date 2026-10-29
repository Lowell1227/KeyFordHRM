import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuthService } from '@/auth/auth.service';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Contract subjects real HTTP and PostgreSQL', () => {
  let app: TestApp;
  let deptId: string;
  let adminId: string;
  let adminToken: string;
  let editorToken: string;
  let reviewerToken: string;
  let employeeToken: string;
  let unprivilegedHrToken: string;
  const runId = randomUUID().slice(0, 8);
  const authorization = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
  const db = () => app.prisma as any;
  function setClock() {
    jest.useFakeTimers({ now: new Date('2035-03-20T04:00:00.000Z'), doNotFake: [
      'nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
      'setInterval', 'clearInterval', 'queueMicrotask', 'performance', 'hrtime',
    ] });
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['localhost', '127.0.0.1'].includes(url.hostname)
      || url.pathname !== '/hrm_contract_subject_test') {
      throw new Error('Requires a disposable loopback hrm_contract_subject_test database');
    }
    process.env.JWT_SECRET = randomUUID();
    process.env.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY = randomUUID();
    process.env.ENABLE_TEST_QUICK_LOGIN = 'false';
    process.env.DINGTALK_NOTIFICATION_ENABLED = 'false';
    process.env.DINGTALK_BOT_STREAM_ENABLED = 'false';
    process.env.DINGTALK_BOT_PREFLIGHT_CONFIRMED = 'false';
    setClock();
    app = await buildTestApp();
    app.app.get(SchedulerRegistry).getCronJobs().forEach((job) => job.stop());
    deptId = (await app.prisma.department.create({ data: { name: `虚拟主体验收部门-${runId}` } })).id;
    async function actor(role: 'hr' | 'hr_user' | 'employee', capabilities: string[] = []) {
      const user = await app.prisma.user.create({ data: {
        name: `虚拟主体验收账号-${randomUUID().slice(0, 8)}`, deptId,
        employeeNo: `SUB-${randomUUID().slice(0, 8)}`, accountType: 'service', sysRole: role,
        status: 'active', hrCapabilities: capabilities as any,
      } });
      const token = (await app.app.get(AuthService).issueToken(user)).token;
      return { user, token };
    }
    const admin = await actor('hr');
    adminId = admin.user.id;
    adminToken = admin.token;
    editorToken = (await actor('hr_user', ['employee_archive_edit'])).token;
    reviewerToken = (await actor('hr_user', ['employee_archive_review'])).token;
    unprivilegedHrToken = (await actor('hr_user')).token;
    employeeToken = (await actor('employee')).token;
  });

  beforeEach(setClock);
  afterEach(() => jest.useRealTimers());
  afterAll(async () => { if (app) await closeTestApp(app); });

  async function subject(suffix: string) {
    const result = await app.http.post('/api/v1/contract-subjects').set(authorization())
      .send({ name: `虚拟合同主体-${runId}-${suffix}` }).expect(201);
    return result.body.data as { id: string; name: string; isActive: boolean };
  }
  function employeeInput(extra: Record<string, unknown> = {}): Record<string, any> {
    return {
      name: `虚拟主体员工-${randomUUID().slice(0, 8)}`, company: 'fuede', deptId,
      entryDate: '2035-03-01', effectiveFrom: '2035-03-01',
      employmentType: 'full_time', employeeStatus: 'active',
      employee: {}, profile: {}, contracts: [], ...extra,
    };
  }
  async function approve(requestId: string, success = true) {
    const result = await app.http.post('/api/v1/employee-archives/reviews/approve')
      .set(authorization()).send({ requestIds: [requestId], scopes: ['profile', 'performance'] }).expect(201);
    if (success) expect(result.body.data.failed).toEqual([]);
    else expect(result.body.data.failed).toHaveLength(1);
    return result.body.data;
  }
  async function formal(extra: Record<string, unknown> = {}) {
    const result = await app.http.post('/api/v1/employee-archives').set(authorization())
      .send(employeeInput(extra)).expect(201);
    await approve(result.body.data.id);
    const request = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: result.body.data.id } });
    return { userId: request.userId!, requestId: request.id };
  }
  async function archive(userId: string) {
    const result = await app.http.get(`/api/v1/employee-archives/${userId}`).set(authorization()).expect(200);
    return result.body.data;
  }

  it('enforces read and maintenance permissions through the real guards', async () => {
    await app.http.get('/api/v1/contract-subjects').expect(401);
    for (const token of [employeeToken, unprivilegedHrToken]) {
      await app.http.get('/api/v1/contract-subjects').set(authorization(token)).expect(403);
    }
    for (const token of [editorToken, reviewerToken]) {
      await app.http.get('/api/v1/contract-subjects').set(authorization(token)).expect(200);
      await app.http.post('/api/v1/contract-subjects').set(authorization(token)).send({ name: '不可越权创建' }).expect(403);
    }
    const current = await subject('权限');
    await app.http.patch(`/api/v1/contract-subjects/${current.id}`).set(authorization(editorToken))
      .send({ name: '不可越权改名' }).expect(403);
    await app.http.patch(`/api/v1/contract-subjects/${current.id}`).set(authorization(reviewerToken))
      .send({ isActive: false }).expect(403);
  });

  it('normalizes unique names, validates writes, filters inactive entries, and audits changes', async () => {
    const current = await subject('目录');
    await app.http.get('/api/v1/contract-subjects?includeInactive=invalid').set(authorization()).expect(400);
    await app.http.post('/api/v1/contract-subjects').set(authorization())
      .send({ name: `  ${current.name}  ` }).expect(409);
    for (const name of ['', '   ', '甲'.repeat(151)]) {
      await app.http.post('/api/v1/contract-subjects').set(authorization()).send({ name }).expect(400);
    }
    await app.http.patch(`/api/v1/contract-subjects/${current.id}`).set(authorization())
      .send({ isActive: 'false' }).expect(400);
    await app.http.patch(`/api/v1/contract-subjects/${current.id}`).set(authorization())
      .send({ isActive: false }).expect(200);
    const active = await app.http.get('/api/v1/contract-subjects?includeInactive=false').set(authorization()).expect(200);
    expect(active.body.data.some((item: any) => item.id === current.id)).toBe(false);
    const all = await app.http.get('/api/v1/contract-subjects?includeInactive=true').set(authorization()).expect(200);
    expect(all.body.data).toContainEqual(expect.objectContaining({ id: current.id, isActive: false }));
    await app.http.patch(`/api/v1/contract-subjects/${current.id}`).set(authorization())
      .send({ isActive: true, name: `  ${current.name}更正  ` }).expect(200);
    expect(await db().contractSubject.findUnique({ where: { id: current.id } }))
      .toMatchObject({ isActive: true, name: `${current.name}更正` });
    expect(await app.prisma.auditLog.count({ where: { userId: adminId, entityId: current.id } })).toBeGreaterThanOrEqual(3);
  });

  it('persists independent employment/contract references and freezes draft names across rename and approval', async () => {
    const employment = await subject('任职快照');
    const contract = await subject('合同快照');
    const payload = employeeInput({
      employee: { contractSubjectId: employment.id, companyText: '客户端伪造名称' },
      contracts: [{ contractType: 'contract', name: '虚拟劳动合同', contractSubjectId: contract.id, signingCompany: '客户端伪造签约名称' }],
    });
    const draft = await app.http.post('/api/v1/employee-archives/drafts').set(authorization()).send(payload).expect(201);
    expect(draft.body.data.proposedValue.employee).toMatchObject({ contractSubjectId: employment.id, companyText: employment.name });
    expect(draft.body.data.proposedValue.contracts[0]).toMatchObject({ contractSubjectId: contract.id, signingCompany: contract.name });
    for (const item of [employment, contract]) {
      await app.http.patch(`/api/v1/contract-subjects/${item.id}`).set(authorization())
        .send({ name: `${item.name}新名称` }).expect(200);
    }
    const resumed = await app.http.post('/api/v1/employee-archives/drafts').set(authorization())
      .send({ ...payload, draftId: draft.body.data.id, employee: { contractSubjectId: employment.id, companyText: employment.name },
        contracts: [{ ...payload.contracts[0], signingCompany: contract.name }] }).expect(201);
    expect(resumed.body.data.proposedValue.employee.companyText).toBe(employment.name);
    const submitted = await app.http.post('/api/v1/employee-archives').set(authorization())
      .send({ ...payload, draftId: draft.body.data.id }).expect(201);
    await approve(submitted.body.data.id);
    const request = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: submitted.body.data.id } });
    const result = await archive(request.userId!);
    expect(result.currentEmployment).toMatchObject({ contractSubjectId: employment.id, companyText: employment.name });
    expect(result.employeeContracts[0]).toMatchObject({ contractSubjectId: contract.id, signingCompany: contract.name });
  });

  it('allows an unchanged inactive reference and preserves it when legacy JSON omits the new field', async () => {
    const current = await subject('停用兼容');
    const { userId } = await formal({ employee: { contractSubjectId: current.id },
      contracts: [{ contractType: 'contract', contractSubjectId: current.id }] });
    await app.http.patch(`/api/v1/contract-subjects/${current.id}`).set(authorization()).send({ isActive: false }).expect(200);
    const change = await app.http.patch(`/api/v1/employee-archives/${userId}/draft`).set(authorization())
      .send({ employee: { workLocation: '虚拟异地办公室' }, profile: {} }).expect(200);
    const request = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: change.body.data.id } });
    const base = request.baseValue as any;
    const proposed = request.proposedValue as any;
    delete base.employee.contractSubjectId;
    delete proposed.employee.contractSubjectId;
    for (const record of [...base.contracts, ...proposed.contracts]) delete record.contractSubjectId;
    await app.prisma.employeeDataChangeRequest.update({ where: { id: request.id }, data: { baseValue: base, proposedValue: proposed } });
    await approve(request.id);
    const result = await archive(userId);
    expect(result.currentEmployment).toMatchObject({ contractSubjectId: current.id, companyText: current.name, workLocation: '虚拟异地办公室' });
    expect(result.employeeContracts[0]).toMatchObject({ contractSubjectId: current.id, signingCompany: current.name });
    await app.http.post('/api/v1/employee-archives').set(authorization())
      .send(employeeInput({ employee: { contractSubjectId: current.id } })).expect(400);
  });

  it('rejects unknown references and a subject disabled after submission without creating a person', async () => {
    await app.http.post('/api/v1/employee-archives').set(authorization())
      .send(employeeInput({ employee: { contractSubjectId: 'not-a-uuid' } })).expect(400);
    await app.http.post('/api/v1/employee-archives').set(authorization())
      .send(employeeInput({ employee: { contractSubjectId: randomUUID() } })).expect(400);
    const current = await subject('提交后停用');
    const payload = employeeInput({ employee: { contractSubjectId: current.id } });
    const change = await app.http.post('/api/v1/employee-archives').set(authorization()).send(payload).expect(201);
    await app.http.patch(`/api/v1/contract-subjects/${current.id}`).set(authorization()).send({ isActive: false }).expect(200);
    const result = await approve(change.body.data.id, false);
    expect(result.failed[0].reason).toContain('合同主体');
    expect(await app.prisma.user.count({ where: { name: payload.name } })).toBe(0);
  });

  it('reviews an ID-only link change with the same name and supports explicit clearing', async () => {
    const current = await subject('仅关联变化');
    const { userId } = await formal({ employee: { companyText: current.name },
      contracts: [{ contractType: 'contract', signingCompany: current.name }] });
    const before = await archive(userId);
    const change = await app.http.patch(`/api/v1/employee-archives/${userId}/draft`).set(authorization()).send({
      employee: { contractSubjectId: current.id }, profile: {},
      contracts: before.employeeContracts.map((item: any) => ({ ...item, contractSubjectId: current.id })),
    }).expect(200);
    expect(change.body.data.profileReviewStatus).toBe('pending');
    await approve(change.body.data.id);
    expect((await archive(userId)).currentEmployment.contractSubjectId).toBe(current.id);
    const linked = await archive(userId);
    const clear = await app.http.patch(`/api/v1/employee-archives/${userId}/draft`).set(authorization()).send({
      employee: { contractSubjectId: null, companyText: null }, profile: {},
      contracts: linked.employeeContracts.map((item: any) => ({ ...item, contractSubjectId: null, signingCompany: null })),
    }).expect(200);
    await approve(clear.body.data.id);
    const result = await archive(userId);
    expect(result.currentEmployment).toMatchObject({ contractSubjectId: null, companyText: null });
    expect(result.employeeContracts[0]).toMatchObject({ contractSubjectId: null, signingCompany: null });
  });

  it('stores a future employment subject without changing the current employment or contract', async () => {
    const oldSubject = await subject('当前任职');
    const nextSubject = await subject('未来任职');
    const { userId } = await formal({ employee: { contractSubjectId: oldSubject.id },
      contracts: [{ contractType: 'contract', contractSubjectId: oldSubject.id }] });
    const submitted = await app.http.post(`/api/v1/employee-archives/${userId}/employments`).set(authorization()).send({
      company: 'fuede', contractSubjectId: nextSubject.id, deptId, effectiveFrom: '2035-04-01',
      employmentType: 'full_time', employeeStatus: 'active', changeType: 'data_correction',
    }).expect(201);
    await app.http.patch(`/api/v1/contract-subjects/${nextSubject.id}`).set(authorization())
      .send({ name: `${nextSubject.name}改名` }).expect(200);
    await approve(submitted.body.data.id);
    expect(await app.prisma.employmentRecord.findUnique({ where: { sourceRequestId: submitted.body.data.id } }))
      .toMatchObject({ contractSubjectId: nextSubject.id, companyText: nextSubject.name });
    const result = await archive(userId);
    expect(result.currentEmployment).toMatchObject({ contractSubjectId: oldSubject.id, companyText: oldSubject.name });
    expect(result.employeeContracts[0]).toMatchObject({ contractSubjectId: oldSubject.id, signingCompany: oldSubject.name });
  });

  it('carries the selected subject through reentry approval into a new employment record', async () => {
    const current = await subject('再入职');
    const person = await app.prisma.user.create({ data: {
      name: `虚拟再入职-${runId}`, employeeNo: `OLD-${runId}`, status: 'resigned',
      sysRole: 'employee', accountType: 'employee', deptId, entryDate: new Date('2030-01-01'),
    } });
    await app.prisma.employmentRecord.create({ data: {
      userId: person.id, company: 'fuede', deptId, effectiveFrom: new Date('2030-01-01'),
      effectiveTo: new Date('2030-12-31'), employeeStatus: 'resigned', changeType: 'hire',
    } });
    const submitted = await app.http.post(`/api/v1/employee-archives/${person.id}/reentry`).set(authorization()).send({
      company: 'fuede', contractSubjectId: current.id, deptId, effectiveDate: '2035-03-01',
      employmentType: 'full_time', employeeStatus: 'active',
    }).expect(201);
    await approve(submitted.body.data.id);
    expect(await app.prisma.employmentRecord.findUnique({ where: { sourceRequestId: submitted.body.data.id } }))
      .toMatchObject({ contractSubjectId: current.id, companyText: current.name });
  });
});

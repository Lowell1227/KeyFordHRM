import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Workbook } from 'exceljs';
import { AuthService } from '@/auth/auth.service';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { browserCompanyAndOnboarding, startRealBrowser, stopRealBrowser } from './real-browser';

describe('Unified company directory: real HTTP, JWT, migrations and PostgreSQL', () => {
  let app: TestApp;
  let deptId: string;
  let positionId: string;
  let editor: string;
  let reviewer: string;
  let employee: string;
  let admin: string;
  const runId = randomUUID().slice(0, 8);
  const root = '/api/v1/employee-archives';
  const auth = (token = editor) => ({ Authorization: `Bearer ${token}` });
  const clock = () => jest.useFakeTimers({ now: new Date('2035-03-20T04:00:00.000Z'), doNotFake: [
    'nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'queueMicrotask', 'performance', 'hrtime',
  ] });

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? '');
    const redis = new URL(process.env.REDIS_URL ?? '');
    if (database.hostname !== '127.0.0.1' || database.pathname !== '/hrm_company_directory_test'
      || database.port === '5432' || redis.hostname !== '127.0.0.1' || redis.port === '6379'
      || !process.env.COMPANY_DIRECTORY_TEST_RUN_ID) throw new Error('Requires the owned disposable company-directory runner');
    process.env.DINGTALK_INTERVIEW_CALENDAR_ENABLED = 'false';
    clock();
    app = await buildTestApp();
    app.app.get(SchedulerRegistry).getCronJobs().forEach(job => job.stop());
    deptId = (await app.prisma.department.create({ data: { name: `虚拟公司验证部门-${runId}`, company: 'fuede' } })).id;
    positionId = (await app.prisma.position.create({ data: { name: `虚拟公司验证岗位-${runId}`, code: `COMP-${runId}` } })).id;
    editor = (await actor('hr_user', ['employee_archive_edit'])).token;
    reviewer = (await actor('hr_user', ['employee_archive_review'])).token;
    employee = (await actor('employee', [])).token;
    admin = (await actor('hr', [])).token;
    if (process.env.COMPANY_DIRECTORY_BROWSER === 'true') await startRealBrowser(app);
  });
  beforeEach(clock);
  afterEach(() => jest.useRealTimers());
  afterAll(async () => { await stopRealBrowser(); if (app) await closeTestApp(app); });

  async function actor(sysRole: 'hr' | 'hr_user' | 'employee', hrCapabilities: string[], department = deptId) {
    const user = await app.prisma.user.create({ data: {
      name: `虚拟身份-${randomUUID().slice(0, 8)}`, employeeNo: `ACT-${randomUUID().slice(0, 8)}`,
      accountType: 'service', status: 'active', sysRole, hrCapabilities, deptId: department,
    } });
    return { user, token: (await app.app.get(AuthService).issueToken(user)).token };
  }
  async function company(suffix: string) {
    const result = await app.http.post('/api/v1/contract-subjects').set(auth())
      .send({ name: `虚拟公司-${runId}-${suffix}-${randomUUID().slice(0, 4)}` }).expect(201);
    const saved = await app.prisma.contractSubject.findUniqueOrThrow({ where: { id: result.body.data.id } });
    expect(saved.internalCompany).toBeNull();
    return saved;
  }
  const input = (subjectId: string, extra: Record<string, any> = {}) => ({
    name: `虚拟公司员工-${randomUUID().slice(0, 8)}`, deptId, positionId,
    entryDate: '2035-03-01', effectiveFrom: '2035-03-01', employmentType: 'full_time', employeeStatus: 'active',
    employee: { contractSubjectId: subjectId }, profile: {}, contracts: [], ...extra,
  });
  async function archive(id: string) {
    return (await app.http.get(`${root}/${id}`).set(auth()).expect(200)).body.data;
  }
  async function approve(id: string, expectSuccess = true) {
    const seen = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id } });
    const response = await app.http.post(`${root}/reviews/approve`).set(auth(reviewer))
      .send({ requestIds: [id], requestVersions: { [id]: seen.requestVersion }, scopes: ['profile', 'performance'] }).expect(201);
    if (expectSuccess) expect(response.body.data.failed).toEqual([]);
    else expect(response.body.data.failed).toHaveLength(1);
    return response.body.data;
  }
  async function arrive(id: string) {
    const request = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id } });
    expect(request.onboardingStatus).toBe('pending_entry');
    expect(request.requiresArrivalConfirmation).toBe(true);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: request.userId! } })).status).toBe('pending_entry');
    await app.http.post(`${root}/applications/${id}/confirm-arrival`).set(auth(reviewer))
      .send({ arrivalDate: '2035-03-01', requestVersion: request.requestVersion }).expect(201);
    const final = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id } });
    expect(final.onboardingStatus).toBe('effective');
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: final.userId! } })).status).toBe('active');
    return final.userId!;
  }
  async function formal(subjectId: string, extra: Record<string, any> = {}) {
    const result = await app.http.post(root).set(auth()).send(input(subjectId, extra)).expect(201);
    await approve(result.body.data.id);
    return arrive(result.body.data.id);
  }
  async function edit(id: string, employeeChanges: Record<string, unknown>, contracts?: unknown[]) {
    const current = await archive(id);
    if (typeof employeeChanges.workLocation === 'string' && !employeeChanges.workLocationId) {
      employeeChanges = { ...employeeChanges, workLocationId: await location(employeeChanges.workLocation) };
    }
    const result = await app.http.patch(`${root}/${id}/draft`).set(auth()).send({
      baseVersion: current.archiveVersion, employee: employeeChanges, profile: {},
      ...(contracts ? { contracts } : {}),
    }).expect(200);
    expect(result.body.data.reviewOutcome).toBe('not_required');
    return result.body.data;
  }
  async function location(name: string) {
    return (await app.prisma.personnelReferenceData.upsert({
      where: { kind_name: { kind: 'work_location', name } }, create: { kind: 'work_location', name }, update: {},
    })).id;
  }

  it('keeps pre-migration legacy data and permits a null legacy code', async () => {
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { id: '22222222-2222-4222-8222-222222222222' } }))
      .toMatchObject({ company: 'fuede', companyText: 'Synthetic legacy snapshot' });
    const nullable = await app.prisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns WHERE table_name='employment_records' AND column_name='company'`;
    expect(nullable).toEqual([{ is_nullable: 'YES' }]);
    const user = await app.prisma.user.create({ data: { name: `虚拟空旧码-${runId}` } });
    const record = await app.prisma.employmentRecord.create({ data: {
      userId: user.id, effectiveFrom: new Date('2035-03-01'), changeType: 'hire', company: null,
    } });
    expect(record.company).toBeNull();
  });

  it('allows an archive editor to maintain the directory and denies employee/reviewer-only writes', async () => {
    const subject = await company('权限');
    for (const token of [employee, reviewer]) {
      await app.http.post('/api/v1/contract-subjects').set(auth(token)).send({ name: '虚拟越权创建' }).expect(403);
      await app.http.patch(`/api/v1/contract-subjects/${subject.id}`).set(auth(token)).send({ isActive: false }).expect(403);
    }
    await app.http.get('/api/v1/contract-subjects').set(auth(reviewer)).expect(200);
    await app.http.get('/api/v1/contract-subjects').set(auth(employee)).expect(403);
    await app.http.patch(`/api/v1/contract-subjects/${subject.id}`).set(auth()).send({ isActive: false }).expect(200);
  });

  it.each([{}, { companyText: '虚拟任意新公司原文不能替代目录' }])('allows an incomplete draft but rejects an unlinked new-hire submission (%j)', async employeeFields => {
    const payload = input('', { employee: employeeFields });
    const before = await Promise.all([app.prisma.user.count(), app.prisma.employeeDataChangeRequest.count(), app.prisma.employeeNumberAssignment.count()]);
    await app.http.post(root).set(auth()).send(payload).expect(400);
    expect(await Promise.all([app.prisma.user.count(), app.prisma.employeeDataChangeRequest.count(), app.prisma.employeeNumberAssignment.count()])).toEqual(before);
    const draft = (await app.http.post(`${root}/drafts`).set(auth()).send(payload).expect(201)).body.data;
    expect(draft.recordStatus).toBe('draft');
    expect(await app.prisma.user.count({ where: { name: payload.name } })).toBe(0);
    const beforeReplay = await Promise.all([app.prisma.user.count(), app.prisma.employeeDataChangeRequest.count(), app.prisma.employeeNumberAssignment.count()]);
    await app.http.post(root).set(auth()).send({ ...payload, draftId: draft.id, expectedVersion: draft.requestVersion }).expect(400);
    expect(await Promise.all([app.prisma.user.count(), app.prisma.employeeDataChangeRequest.count(), app.prisma.employeeNumberAssignment.count()])).toEqual(beforeReplay);
  });

  it.each([{}, { companyText: '虚拟任意再入职公司原文' }])('rejects an unlinked reentry submission before creating an application or number (%j)', async companyFields => {
    const person = await app.prisma.user.create({ data: { name: `虚拟空公司再入职-${runId}`,
      employeeNo: `EMPTY-${randomUUID().slice(0, 8)}`, status: 'resigned', deptId, accountType: 'employee' } });
    const before = await Promise.all([app.prisma.employeeDataChangeRequest.count(), app.prisma.employeeNumberAssignment.count()]);
    await app.http.post(`${root}/${person.id}/reentry`).set(auth()).send({
      deptId, effectiveDate: '2035-03-01', employmentType: 'full_time', employeeStatus: 'active', ...companyFields,
    }).expect(400);
    expect(await Promise.all([app.prisma.employeeDataChangeRequest.count(), app.prisma.employeeNumberAssignment.count()])).toEqual(before);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: person.id } })).status).toBe('resigned');
  });

  it.each([
    { company: null, companyText: null },
    { company: 'fuede' as const, companyText: null },
    { company: null, companyText: '虚拟历史原文公司' },
  ])('preserves historical company data during an unrelated archive edit (%j)', async companyFields => {
    const person = await app.prisma.user.create({ data: { name: `虚拟历史公司-${randomUUID().slice(0, 8)}`,
      employeeNo: `HIST-${randomUUID().slice(0, 8)}`, deptId, status: 'active', entryDate: new Date('2035-03-01') } });
    await app.prisma.employmentRecord.create({ data: { ...companyFields, userId: person.id,
      deptId, effectiveFrom: new Date('2035-03-01'), changeType: 'hire', employeeStatus: 'active' } });
    await edit(person.id, { workLocation: '虚拟历史资料更正工作地' });
    expect((await archive(person.id)).currentEmployment).toMatchObject({ ...companyFields,
      contractSubjectId: null, workLocation: '虚拟历史资料更正工作地' });
  });

  it('accepts a valid legacy code from an older new-hire client without inventing a directory reference', async () => {
    const userId = await formal('', { employee: {}, company: 'fuede' });
    expect((await archive(userId)).currentEmployment).toMatchObject({ company: 'fuede', companyText: null, contractSubjectId: null });
  });

  it('completes draft/resume/submit/review/arrival with independent unmapped company and contract snapshots', async () => {
    const employment = await company('入职');
    const contract = await company('签约');
    const payload = input(employment.id, {
      employee: { contractSubjectId: employment.id, companyText: '虚拟客户端伪造名称' },
      contracts: [{ contractType: 'contract', name: '虚拟劳动合同', contractSubjectId: contract.id, signingCompany: '虚拟客户端伪造名称' }],
    });
    const draft = (await app.http.post(`${root}/drafts`).set(auth()).send(payload).expect(201)).body.data;
    expect(draft.proposedValue.employee).toMatchObject({ company: null, contractSubjectId: employment.id, companyText: employment.name });
    expect(draft.proposedValue.contracts[0]).toMatchObject({ contractSubjectId: contract.id, signingCompany: contract.name });
    for (const subject of [employment, contract]) await app.http.patch(`/api/v1/contract-subjects/${subject.id}`).set(auth())
      .send({ name: `${subject.name}已改名` }).expect(200);
    const resumed = (await app.http.post(`${root}/drafts`).set(auth()).send({ ...payload,
      draftId: draft.id, expectedVersion: draft.requestVersion,
    }).expect(201)).body.data;
    expect(resumed.proposedValue.employee.companyText).toBe(employment.name);
    expect(resumed.proposedValue.contracts[0].signingCompany).toBe(contract.name);
    const submitted = (await app.http.post(root).set(auth()).send({ ...payload,
      draftId: draft.id, expectedVersion: resumed.requestVersion,
    }).expect(201)).body.data;
    await approve(submitted.id);
    const userId = await arrive(submitted.id);
    const result = await archive(userId);
    expect(result.currentEmployment).toMatchObject({ company: null, contractSubjectId: employment.id, companyText: employment.name });
    expect(result.employeeContracts[0]).toMatchObject({ contractSubjectId: contract.id, signingCompany: contract.name });
  });

  it('directly edits employment company independently of the contract and retains inactive historical snapshots', async () => {
    const first = await company('原任职');
    const next = await company('新任职');
    const contract = await company('合同独立');
    const userId = await formal(first.id, { contracts: [{ contractType: 'contract', contractSubjectId: contract.id }] });
    await edit(userId, { contractSubjectId: next.id });
    let result = await archive(userId);
    expect(result.currentEmployment).toMatchObject({ company: null, contractSubjectId: next.id, companyText: next.name });
    expect(result.employeeContracts[0]).toMatchObject({ contractSubjectId: contract.id, signingCompany: contract.name });
    await edit(userId, {}, result.employeeContracts.map((item: any) => ({ ...item, contractSubjectId: first.id })));
    result = await archive(userId);
    expect(result.currentEmployment.contractSubjectId).toBe(next.id);
    expect(result.employeeContracts[0]).toMatchObject({ contractSubjectId: first.id, signingCompany: first.name });
    await app.http.patch(`/api/v1/contract-subjects/${next.id}`).set(auth()).send({ name: `${next.name}已改名`, isActive: false }).expect(200);
    await edit(userId, { workLocation: '虚拟新工作地' });
    expect((await archive(userId)).currentEmployment).toMatchObject({ company: null, contractSubjectId: next.id, companyText: next.name });
    await app.http.post(root).set(auth()).send(input(next.id)).expect(400);
  });

  it('does not overwrite a company when an old archive draft omits its reference', async () => {
    const subject = await company('旧草稿');
    const userId = await formal(subject.id);
    const current = await archive(userId);
    const workLocationId = await location('虚拟旧草稿工作地');
    const saved = (await app.http.patch(`${root}/${userId}/draft/save`).set(auth()).send({
      baseVersion: current.archiveVersion, employee: { workLocation: '虚拟旧草稿工作地', workLocationId }, profile: {},
    }).expect(200)).body.data;
    const request = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: saved.id } });
    const base = request.baseValue as any;
    const proposed = request.proposedValue as any;
    delete base.employee.contractSubjectId;
    delete proposed.employee.contractSubjectId;
    await app.prisma.employeeDataChangeRequest.update({ where: { id: saved.id }, data: { baseValue: base, proposedValue: proposed } });
    await app.http.patch(`/api/v1/contract-subjects/${subject.id}`).set(auth()).send({ isActive: false }).expect(200);
    const applied = await app.http.patch(`${root}/${userId}/draft`).set(auth()).send({
      draftId: saved.id, expectedVersion: saved.requestVersion, baseVersion: current.archiveVersion,
      employee: { workLocation: '虚拟旧草稿工作地', workLocationId }, profile: {},
    });
    if (applied.status !== 200) throw new Error(`Old draft replay returned ${applied.status}: ${JSON.stringify(applied.body)}`);
    expect((await archive(userId)).currentEmployment).toMatchObject({ company: null,
      contractSubjectId: subject.id, companyText: subject.name, workLocation: '虚拟旧草稿工作地' });
  });

  it('rejects a newly selected company disabled after submission without formalizing a person', async () => {
    const subject = await company('审核前停用');
    const payload = input(subject.id);
    const request = (await app.http.post(root).set(auth()).send(payload).expect(201)).body.data;
    await app.http.patch(`/api/v1/contract-subjects/${subject.id}`).set(auth()).send({ isActive: false }).expect(200);
    await approve(request.id, false);
    expect(await app.prisma.employmentRecord.count({ where: { sourceRequestId: request.id } })).toBe(0);
    expect(await app.prisma.user.count({ where: { name: payload.name } })).toBe(0);
  });

  it('projects reentry with an unmapped company and keeps the former legacy employment intact', async () => {
    const subject = await company('再入职');
    const person = await app.prisma.user.create({ data: {
      name: `虚拟再入职-${runId}`, employeeNo: `FORMER-${runId}`, status: 'resigned',
      accountType: 'employee', deptId, entryDate: new Date('2030-01-01'),
    } });
    const old = await app.prisma.employmentRecord.create({ data: { userId: person.id,
      company: 'fuede', companyText: '虚拟旧公司快照', deptId, effectiveFrom: new Date('2030-01-01'),
      effectiveTo: new Date('2030-12-31'), employeeStatus: 'resigned', changeType: 'hire',
    } });
    const request = (await app.http.post(`${root}/${person.id}/reentry`).set(auth()).send({
      contractSubjectId: subject.id, deptId, effectiveDate: '2035-03-01', employmentType: 'full_time', employeeStatus: 'active',
    }).expect(201)).body.data;
    await approve(request.id);
    const approved = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: request.id } });
    if (approved.requiresArrivalConfirmation) await arrive(request.id);
    expect((await archive(person.id)).currentEmployment).toMatchObject({ company: null,
      contractSubjectId: subject.id, companyText: subject.name, employeeStatus: 'active' });
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { id: old.id } }))
      .toMatchObject({ company: 'fuede', companyText: '虚拟旧公司快照' });
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: person.id } })).status).toBe('active');
  });

  it('exports exactly one company column for a saved legacy organization selection', async () => {
    const subject = await company('导出');
    const name = `虚拟导出唯一-${runId}`;
    await formal(subject.id, { name });
    const response = await app.http.get('/api/v1/users/export').set(auth(admin))
      .query({ keyword: name, columns: 'name,organization,companyText' }).buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      }).expect(200);
    const workbook = new Workbook();
    await workbook.xlsx.load(response.body);
    const sheet = workbook.worksheets[0];
    const cells: string[] = [];
    sheet.eachRow(row => row.eachCell(cell => cells.push(cell.text)));
    expect(cells.filter(value => value === '所属公司')).toHaveLength(1);
    expect(cells).toContain(subject.name);
    expect(cells).not.toContain('内部公司');
    expect(cells).not.toContain('组织分类');
  });

  it('uses the shared current company identity for ordinary HR scope across legacy departments', async () => {
    const shared = await company('范围共同目录');
    const otherDept = await app.prisma.department.create({ data: { name: `虚拟异组织-${runId}`, company: 'fansibao' } });
    const hr = await actor('hr_user', ['confirmation_manage']);
    await app.prisma.employmentRecord.create({ data: {
      userId: hr.user.id, employeeNo: hr.user.employeeNo, deptId,
      contractSubjectId: shared.id, company: null, effectiveFrom: new Date('2035-03-01'),
      changeType: 'hire', employeeStatus: 'active',
    } });
    const sameId = await formal(shared.id);
    const otherId = await formal(shared.id, { deptId: otherDept.id });
    const same = await app.prisma.confirmationApplication.create({ data: { employeeId: sameId, status: 'manager_approved', workflowVersion: 2 } });
    const other = await app.prisma.confirmationApplication.create({ data: { employeeId: otherId, status: 'manager_approved', workflowVersion: 2 } });
    await app.http.get(`/api/v1/confirmation-applications/${same.id}`).set(auth(hr.token)).expect(200);
    await app.http.get(`/api/v1/confirmation-applications/${other.id}`).set(auth(hr.token)).expect(200);
    const outsideId = await formal((await company('不同范围公司')).id);
    const outside = await app.prisma.confirmationApplication.create({ data: {
      employeeId: outsideId, status: 'manager_approved', workflowVersion: 2,
    } });
    await app.http.get(`/api/v1/confirmation-applications/${outside.id}`).set(auth(hr.token)).expect(403);
    expect((await archive(sameId)).currentEmployment.contractSubjectId).toBe(shared.id);
    expect((await archive(otherId)).currentEmployment.contractSubjectId).toBe(shared.id);
  });

  (process.env.COMPANY_DIRECTORY_BROWSER === 'true' ? it : it.skip).each([1440, 390])(
    'submits a newly created company through the real browser and backend at %ipx', async width => {
      const dept = await app.prisma.department.findUniqueOrThrow({ where: { id: deptId } });
      const result = await browserCompanyAndOnboarding(width, editor, dept.name, `虚拟公司验证岗位-${runId}`);
      expect((await app.prisma.contractSubject.findUniqueOrThrow({ where: { id: result.subject.id } })).internalCompany).toBeNull();
      const request = await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: result.request.id } });
      expect((request.proposedValue as any).employee).toMatchObject({ contractSubjectId: result.subject.id,
        companyText: result.subject.name, company: null, name: result.employeeName });
      await approve(request.id);
      const userId = await arrive(request.id);
      expect((await archive(userId)).currentEmployment).toMatchObject({ company: null,
        contractSubjectId: result.subject.id, companyText: result.subject.name });
    }, 180000,
  );
});

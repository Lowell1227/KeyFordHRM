import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuthService } from '@/auth/auth.service';
import { EmployeeEffectiveDateService } from '@/employee-archives/employee-effective-date.service';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Personnel consistency: real HTTP and isolated PostgreSQL', () => {
  let app: TestApp;
  let hr: { user: any; token: string };
  let deptId: string;
  let positionId: string;
  let companyId: string;
  const auth = (actor = hr) => ({ Authorization: `Bearer ${actor.token}` });
  const root = '/api/v1/employee-archives';
  const clock = () => jest.useFakeTimers({ now: new Date('2035-03-20T04:00:00Z'), doNotFake: [
    'nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'queueMicrotask', 'performance', 'hrtime',
  ] });

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/hrm_company_directory_test'
      || url.port === '5432' || !process.env.COMPANY_DIRECTORY_TEST_RUN_ID) throw new Error('Disposable runner required');
    process.env.DINGTALK_INTERVIEW_CALENDAR_ENABLED = 'false';
    clock();
    app = await buildTestApp();
    app.app.get(SchedulerRegistry).getCronJobs().forEach(job => job.stop());
    deptId = (await app.prisma.department.create({ data: { name: `虚构一致性部门-${randomUUID()}`, company: 'fuede' } })).id;
    positionId = (await app.prisma.position.create({ data: { name: '虚构目录岗位', code: `TEST-${randomUUID().slice(0, 12)}` } })).id;
    companyId = (await app.prisma.contractSubject.create({ data: { name: `虚构一致性公司-${randomUUID()}` } })).id;
    hr = await actor('hr');
  });
  beforeEach(clock);
  afterEach(() => jest.useRealTimers());
  afterAll(async () => { if (app) await closeTestApp(app); });

  async function actor(sysRole: 'employee' | 'hr' | 'hr_user', data: Record<string, any> = {}) {
    const user = await app.prisma.user.create({ data: {
      name: `虚构身份-${randomUUID().slice(0, 8)}`, employeeNo: `PC-${randomUUID().slice(0, 8)}`,
      accountType: 'service', sysRole, status: 'active', deptId, ...data,
    } });
    return { user, token: (await app.app.get(AuthService).issueToken(user)).token };
  }
  async function reference(kind: string) {
    return (await app.http.post(`/api/v1/personnel-reference-data/${kind}`).set(auth())
      .send({ name: `虚构${kind}-${randomUUID().slice(0, 8)}` }).expect(201)).body.data;
  }
  async function archive(userId: string) {
    return (await app.http.get(`${root}/${userId}`).set(auth()).expect(200)).body.data;
  }
  async function edit(userId: string, employee: Record<string, any>, profile: Record<string, any>, status = 200) {
    const current = await archive(userId);
    return app.http.patch(`${root}/${userId}/draft`).set(auth())
      .send({ baseVersion: current.archiveVersion, employee, profile }).expect(status);
  }

  it('persists stable reference IDs, retains renamed historical snapshots and clears both values', async () => {
    const education = await reference('education');
    const location = await reference('work_location');
    const person = await actor('employee', { accountType: 'employee', positionId, position: '虚构目录岗位' });
    await app.prisma.employmentRecord.create({ data: {
      userId: person.user.id, employeeNo: person.user.employeeNo, deptId, positionId, position: '虚构目录岗位',
      contractSubjectId: companyId, effectiveFrom: new Date('2035-03-01'), entryDate: new Date('2035-03-01'),
      changeType: 'hire', employeeStatus: 'active', company: null,
    } });
    await edit(person.user.id, { workLocationId: location.id, workLocation: '不可信客户端名称' },
      { educationId: education.id, education: '不可信客户端名称' });
    let saved = await archive(person.user.id);
    expect(saved.currentEmployment).toMatchObject({ workLocationId: location.id, workLocation: location.name });
    expect(saved.employeeProfile).toMatchObject({ educationId: education.id, education: education.name });
    await app.http.patch(`/api/v1/personnel-reference-data/education/${education.id}`).set(auth())
      .send({ name: `${education.name}改名`, isActive: false }).expect(200);
    await edit(person.user.id, {}, { professionalTitle: '虚构无关修改' });
    saved = await archive(person.user.id);
    expect(saved.employeeProfile).toMatchObject({ educationId: education.id, education: education.name });
    const wrongKind = await edit(person.user.id, {}, { educationId: location.id, education: location.name }, 400);
    expect(wrongKind.body.data.fieldErrors['profile.education']).toBeTruthy();
    await edit(person.user.id, { workLocationId: null, workLocation: null }, { educationId: null, education: null });
    saved = await archive(person.user.id);
    expect(saved.employeeProfile).toMatchObject({ educationId: null, education: null });
    expect(saved.currentEmployment).toMatchObject({ workLocationId: null, workLocation: null });
  });

  it('allows incomplete onboarding drafts but rejects a new free-text position on submission', async () => {
    const payload = {
      name: `虚构岗位校验-${randomUUID().slice(0, 8)}`, deptId,
      entryDate: '2035-03-01', effectiveFrom: '2035-03-01', employeeStatus: 'active', employmentType: 'full_time',
      employee: { contractSubjectId: companyId, position: '未关联岗位名称' }, profile: {}, contracts: [],
    };
    const draft = (await app.http.post(`${root}/drafts`).set(auth()).send(payload).expect(201)).body.data;
    const response = await app.http.post(root).set(auth()).send({ ...payload, draftId: draft.id, expectedVersion: draft.requestVersion }).expect(400);
    expect(response.body.data.fieldErrors['employee.positionId']).toBeTruthy();
    expect(await app.prisma.user.count({ where: { name: payload.name } })).toBe(0);
  });

  it('updates canonical names together with ID-only grade and location changes', async () => {
    const oldGrade = await reference('job_grade');
    const newGrade = await reference('job_grade');
    const oldLocation = await reference('work_location');
    const newLocation = await reference('work_location');
    const person = await actor('employee', { accountType: 'employee', positionId });
    await app.prisma.employmentRecord.create({ data: {
      userId: person.user.id, employeeNo: person.user.employeeNo, deptId, positionId,
      position: '虚构目录岗位', contractSubjectId: companyId, effectiveFrom: new Date('2035-03-01'),
      entryDate: new Date('2035-03-01'), changeType: 'hire', employeeStatus: 'active', company: null,
      jobGradeId: oldGrade.id, jobGrade: oldGrade.name, workLocationId: oldLocation.id, workLocation: oldLocation.name,
    } });
    await edit(person.user.id, { jobGradeId: newGrade.id, workLocationId: newLocation.id }, {});
    expect((await archive(person.user.id)).currentEmployment).toMatchObject({
      jobGradeId: newGrade.id, jobGrade: newGrade.name, workLocationId: newLocation.id, workLocation: newLocation.name,
    });
  });

  async function pendingConfirmation(regularDate = '2035-03-20', submitHr = true) {
    const rosterManager = await actor('employee');
    const performanceManager = await actor('employee');
    const approver = await actor('employee');
    const handler = await actor('hr_user', { hrCapabilities: ['confirmation_manage'] });
    await app.prisma.employmentRecord.create({ data: {
      userId: handler.user.id, employeeNo: handler.user.employeeNo, deptId, contractSubjectId: companyId,
      effectiveFrom: new Date('2035-03-01'), changeType: 'hire', employeeStatus: 'active', company: null,
    } });
    await app.prisma.department.update({ where: { id: deptId }, data: { approverId: approver.user.id } });
    const person = await actor('employee', { accountType: 'employee', status: 'probation', directManagerId: performanceManager.user.id,
      entryDate: new Date('2035-03-01'), positionId });
    const employment = await app.prisma.employmentRecord.create({ data: {
      userId: person.user.id, employeeNo: person.user.employeeNo, deptId, positionId,
      directManagerId: rosterManager.user.id, contractSubjectId: companyId,
      effectiveFrom: new Date('2035-03-01'), entryDate: new Date('2035-03-01'),
      employeeStatus: 'probation', company: null, changeType: 'hire',
    } });
    const route = '/api/v1/confirmation-applications';
    const request = (await app.http.post(route).set(auth(person)).send({ summary: '虚构试用工作小结' }).expect(201)).body.data;
    await app.http.post(`${route}/${request.id}/submit`).set(auth(person)).send({ submissionVersion: request.submissionVersion }).expect(201);
    const submitted = await app.prisma.confirmationApplication.findUniqueOrThrow({ where: { id: request.id } });
    expect(submitted).toMatchObject({ managerId: rosterManager.user.id, employmentRecordId: employment.id });
    await app.http.post(`${route}/${request.id}/approve`).set(auth(performanceManager))
      .send({ submissionVersion: submitted.submissionVersion, recommendation: true, comment: '无权审批' }).expect(403);
    await app.http.post(`${route}/${request.id}/approve`).set(auth(rosterManager))
      .send({ submissionVersion: submitted.submissionVersion, recommendation: true, comment: '虚构主管评价' }).expect(201);
    if (submitHr) {
      await app.http.post(`${route}/${request.id}/approve`).set(auth(handler))
        .send({ submissionVersion: submitted.submissionVersion, voteResult: 'pass', voteComment: '虚构评议依据', proposedRegularDate: regularDate }).expect(201);
    }
    return { person, approver, handler, rosterManager, request, employment, route, submissionVersion: submitted.submissionVersion, regularDate };
  }

  async function approveCurrent(flow: Awaited<ReturnType<typeof pendingConfirmation>>) {
    await app.http.post(`${flow.route}/${flow.request.id}/approve`).set(auth(flow.approver))
      .send({ submissionVersion: flow.submissionVersion, confirmedRegularDate: flow.regularDate, comment: '虚构批准' }).expect(201);
  }

  it('routes to the roster manager and keeps an approved confirmation effective after authenticated requests', async () => {
    const flow = await pendingConfirmation();
    const { person, employment, route } = flow;
    await approveCurrent(flow);
    await app.http.get(`${route}/my-roster`).set(auth(person)).expect(200);
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: person.user.id } }))
      .toMatchObject({ status: 'active', actualRegularDate: new Date('2035-03-20') });
    expect((await archive(person.user.id)).currentEmployment)
      .toMatchObject({ employeeStatus: 'active' });
    const historical = await app.prisma.employmentRecord.findUniqueOrThrow({ where: { id: employment.id } });
    expect(historical.employeeStatus).toBe('probation');
    expect(historical.effectiveTo).toEqual(new Date('2035-03-19'));
  });

  it('activates a future confirmation only when its effective date arrives', async () => {
    const flow = await pendingConfirmation('2035-03-21');
    await approveCurrent(flow);
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: flow.person.user.id } }))
      .toMatchObject({ status: 'probation', actualRegularDate: null });
    await app.app.get(EmployeeEffectiveDateService).refreshEffectiveProjections(new Date('2035-03-21T04:00:00Z'));
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: flow.person.user.id } }))
      .toMatchObject({ status: 'active', actualRegularDate: new Date('2035-03-21') });
    expect(await app.prisma.employmentRecord.findUniqueOrThrow({ where: { id: flow.employment.id } }))
      .toMatchObject({ employeeStatus: 'probation', effectiveTo: new Date('2035-03-20') });
  });

  it('retries a stale scheduler snapshot without overwriting concurrent confirmation approval', async () => {
    const flow = await pendingConfirmation();
    let gated = false;
    let enabled = true;
    let release!: () => void;
    let observed!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = new Promise<void>(resolve => { observed = resolve; });
    app.prisma.$use(async (params, next) => {
      const result = await next(params);
      if (enabled && !gated && params.model === 'EmploymentRecord' && params.action === 'findMany'
        && params.args?.where?.userId === flow.person.user.id) {
        gated = true;
        observed();
        await gate;
      }
      return result;
    });
    const refresh = app.app.get(EmployeeEffectiveDateService).refreshEffectiveProjections();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([read, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Scheduler read was not observed')), 3000); })]);
      await approveCurrent(flow);
    } finally {
      enabled = false;
      if (timeout) clearTimeout(timeout);
      release();
      await refresh;
    }
    expect(gated).toBe(true);
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: flow.person.user.id } }))
      .toMatchObject({ status: 'active', actualRegularDate: new Date('2035-03-20') });
  });

  it('rejects stale browser decisions after an application is returned and submitted again', async () => {
    const flow = await pendingConfirmation('2035-03-20', false);
    const endpoint = `${flow.route}/${flow.request.id}`;
    await app.http.post(`${endpoint}/return`).set(auth(flow.handler))
      .send({ submissionVersion: flow.submissionVersion, reason: '请补充工作小结' }).expect(201);
    await app.http.put(endpoint).set(auth(flow.person))
      .send({ submissionVersion: flow.submissionVersion, summary: '第二轮虚构小结' }).expect(200);
    await app.http.post(`${endpoint}/submit`).set(auth(flow.person))
      .send({ submissionVersion: flow.submissionVersion }).expect(201);
    await app.http.post(`${endpoint}/approve`).set(auth(flow.rosterManager))
      .send({ submissionVersion: flow.submissionVersion, recommendation: true, comment: '旧页面意见' }).expect(409);
    expect(await app.prisma.confirmationApplication.findUniqueOrThrow({ where: { id: flow.request.id } }))
      .toMatchObject({ status: 'submitted', submissionVersion: flow.submissionVersion + 1, summary: '第二轮虚构小结' });
  });

  it('recovers an old final-stage application through the assigned company approver without guessing employment identity', async () => {
    const flow = await pendingConfirmation();
    const endpoint = `${flow.route}/${flow.request.id}`;
    await app.prisma.confirmationApplication.update({ where: { id: flow.request.id }, data: { employmentRecordId: null } });
    await app.http.post(`${endpoint}/approve`).set(auth(flow.approver))
      .send({ submissionVersion: flow.submissionVersion, confirmedRegularDate: flow.regularDate }).expect(409);
    await app.http.post(`${endpoint}/return`).set(auth(flow.approver))
      .send({ submissionVersion: flow.submissionVersion, reason: '请重新确认本次任职' }).expect(201);
    await app.http.post(`${endpoint}/submit`).set(auth(flow.person))
      .send({ submissionVersion: flow.submissionVersion }).expect(201);
    const version = flow.submissionVersion + 1;
    expect(await app.prisma.confirmationApplication.findUniqueOrThrow({ where: { id: flow.request.id } }))
      .toMatchObject({ submissionVersion: version, employmentRecordId: flow.employment.id, managerId: flow.rosterManager.user.id });
    await app.http.post(`${endpoint}/approve`).set(auth(flow.rosterManager))
      .send({ submissionVersion: version, recommendation: true, comment: '已重新核对' }).expect(201);
    await app.http.post(`${endpoint}/approve`).set(auth(flow.handler))
      .send({ submissionVersion: version, voteResult: 'pass', voteComment: '已重新核对', proposedRegularDate: flow.regularDate }).expect(201);
    await approveCurrent({ ...flow, submissionVersion: version });
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: flow.person.user.id } }))
      .toMatchObject({ status: 'active' });
  });

  describe('confirmation HR scope uses the current formal company identity', () => {
    type Flow = Awaited<ReturnType<typeof pendingConfirmation>>;
    type Actor = Awaited<ReturnType<typeof actor>>;

    async function anotherCompany() {
      return (await app.prisma.contractSubject.create({ data: { name: `虚构范围公司-${randomUUID()}` } })).id;
    }

    async function employmentFor(person: Actor, contractSubjectId: string | null, overrides: Record<string, any> = {}) {
      return app.prisma.employmentRecord.create({ data: {
        userId: person.user.id, employeeNo: person.user.employeeNo, deptId: person.user.deptId,
        company: null, contractSubjectId, effectiveFrom: new Date('2035-03-01'),
        changeType: 'hire', employeeStatus: 'active', ...overrides,
      } });
    }

    async function handlerFor(contractSubjectId: string | null, capabilities = ['confirmation_manage']) {
      const handler = await actor('hr_user', { hrCapabilities: capabilities });
      await employmentFor(handler, contractSubjectId);
      return handler;
    }

    async function assertHrScope(flow: Flow, handler: Actor, allowed: boolean) {
      const list = (await app.http.get(flow.route).query({ employeeId: flow.person.user.id })
        .set(auth(handler)).expect(200)).body.data;
      expect(list.total).toBe(allowed ? 1 : 0);
      expect(list.items.map((item: any) => item.id)).toEqual(allowed ? [flow.request.id] : []);
      const pending = (await app.http.get(`${flow.route}/pending`).query({ employeeId: flow.person.user.id })
        .set(auth(handler)).expect(200)).body.data;
      expect(pending.items.map((item: any) => item.id)).toEqual(allowed ? [flow.request.id] : []);
      const detail = await app.http.get(`${flow.route}/${flow.request.id}`).set(auth(handler)).expect(allowed ? 200 : 403);
      if (allowed) {
        expect(detail.body.data).toMatchObject({ canApprove: true, canReturn: true, pendingRole: 'hr' });
      } else {
        await app.http.post(`${flow.route}/${flow.request.id}/approve`).set(auth(handler))
          .send({ submissionVersion: flow.submissionVersion, voteResult: 'pass', voteComment: '不应生效的越界评议',
            proposedRegularDate: flow.regularDate }).expect(403);
        expect(await app.prisma.confirmationApplication.findUniqueOrThrow({ where: { id: flow.request.id } }))
          .toMatchObject({ status: 'manager_approved', hrApprovedAt: null, voteResult: null });
      }
    }

    it('allows the same company ID across different legacy department company codes', async () => {
      const flow = await pendingConfirmation('2035-03-20', false);
      const differentDepartment = await app.prisma.department.create({ data: {
        name: `虚构异代码部门-${randomUUID()}`, company: 'fansibao',
      } });
      await app.prisma.user.update({ where: { id: flow.handler.user.id }, data: { deptId: differentDepartment.id } });
      await app.prisma.employmentRecord.updateMany({ where: { userId: flow.handler.user.id }, data: { deptId: differentDepartment.id } });
      await assertHrScope(flow, flow.handler, true);
      await app.http.post(`${flow.route}/${flow.request.id}/approve`).set(auth(flow.handler))
        .send({ submissionVersion: flow.submissionVersion, voteResult: 'pass', voteComment: '同一所属公司评议',
          proposedRegularDate: flow.regularDate }).expect(201);
      expect(await app.prisma.confirmationApplication.findUniqueOrThrow({ where: { id: flow.request.id } }))
        .toMatchObject({ status: 'hr_approved', hrId: flow.handler.user.id });
    });

    it('denies a different company ID even when both people share the same legacy department code', async () => {
      const flow = await pendingConfirmation('2035-03-20', false);
      const outsider = await handlerFor(await anotherCompany());
      expect(outsider.user.deptId).toBe(flow.person.user.deptId);
      await assertHrScope(flow, outsider, false);
    });

    it.each(['handler', 'employee'] as const)('does not fall back to a department code or older company when the %s current company ID is empty', async owner => {
      const flow = await pendingConfirmation('2035-03-20', false);
      const person = owner === 'handler' ? flow.handler : flow.person;
      await app.prisma.employmentRecord.updateMany({ where: { userId: person.user.id }, data: { contractSubjectId: null } });
      await employmentFor(person, companyId, { effectiveFrom: new Date('2035-02-01') });
      await assertHrScope(flow, flow.handler, false);
    });

    it.each(['handler', 'employee'] as const)('ignores past and future records when the %s has no current formal employment', async owner => {
      const flow = await pendingConfirmation('2035-03-20', false);
      const person = owner === 'handler' ? flow.handler : flow.person;
      await app.prisma.employmentRecord.updateMany({ where: { userId: person.user.id }, data: {
        effectiveFrom: new Date('2035-02-01'), effectiveTo: new Date('2035-02-28'),
      } });
      await employmentFor(person, companyId, { effectiveFrom: new Date('2035-04-01') });
      await assertHrScope(flow, flow.handler, false);
    });

    it.each(['handler', 'employee'] as const)('selects only the determined current %s employment across past, future and overlapping companies', async owner => {
      const flow = await pendingConfirmation('2035-03-20', false);
      const person = owner === 'handler' ? flow.handler : flow.person;
      const otherId = await anotherCompany();
      await app.prisma.employmentRecord.updateMany({ where: { userId: person.user.id }, data: { createdAt: new Date('2035-03-01') } });
      await employmentFor(person, otherId, { effectiveFrom: new Date('2035-02-01'), effectiveTo: new Date('2035-02-28') });
      await employmentFor(person, otherId, { effectiveFrom: new Date('2035-04-01') });
      await employmentFor(person, otherId, { effectiveFrom: new Date('2035-02-15') });
      await employmentFor(person, otherId, { effectiveFrom: new Date('2035-03-01'), createdAt: new Date('2035-02-28') });
      await assertHrScope(flow, flow.handler, true);
      if (owner === 'employee') {
        await assertHrScope(flow, await handlerFor(otherId), false);
      } else {
        const otherFlow = await pendingConfirmation('2035-03-20', false);
        await app.prisma.employmentRecord.update({ where: { id: otherFlow.employment.id }, data: { contractSubjectId: otherId } });
        await assertHrScope(otherFlow, flow.handler, false);
      }
    });

    it('requires confirmation_manage even for an HR account in the same company', async () => {
      const flow = await pendingConfirmation('2035-03-20', false);
      const unprivileged = await handlerFor(companyId, ['employee_archive_edit']);
      await app.http.get(flow.route).set(auth(unprivileged)).expect(403);
      await app.http.get(`${flow.route}/${flow.request.id}`).set(auth(unprivileged)).expect(403);
      const pending = (await app.http.get(`${flow.route}/pending`).query({ employeeId: flow.person.user.id })
        .set(auth(unprivileged)).expect(200)).body.data;
      expect(pending.items).toEqual([]);
      await app.http.post(`${flow.route}/${flow.request.id}/approve`).set(auth(unprivileged))
        .send({ submissionVersion: flow.submissionVersion, voteResult: 'pass', voteComment: '无转正办理权限',
          proposedRegularDate: flow.regularDate }).expect(403);
      expect(await app.prisma.confirmationApplication.findUniqueOrThrow({ where: { id: flow.request.id } }))
        .toMatchObject({ status: 'manager_approved', hrApprovedAt: null });
    });

    it('keeps HR administrator management visibility across company IDs and missing current references', async () => {
      const flow = await pendingConfirmation('2035-03-20', false);
      for (const subject of [companyId, await anotherCompany(), null]) {
        await app.prisma.employmentRecord.update({ where: { id: flow.employment.id }, data: { contractSubjectId: subject } });
        const list = (await app.http.get(flow.route).query({ employeeId: flow.person.user.id }).set(auth(hr)).expect(200)).body.data;
        expect(list.items.map((item: any) => item.id)).toEqual([flow.request.id]);
        await app.http.get(`${flow.route}/${flow.request.id}`).set(auth(hr)).expect(200);
      }
    });

    it.each(['manager', 'company'] as const)('retains explicit cross-company %s assignment visibility without granting the HR step', async role => {
      const flow = await pendingConfirmation('2035-03-20', false);
      const assigned = role === 'manager' ? flow.rosterManager : flow.approver;
      const user = await app.prisma.user.update({ where: { id: assigned.user.id }, data: {
        sysRole: 'hr_user', hrCapabilities: ['confirmation_manage'],
      } });
      const viewer = { user, token: (await app.app.get(AuthService).issueToken(user)).token };
      await employmentFor(viewer, await anotherCompany());
      for (const path of [flow.route, `${flow.route}/assigned`]) {
        const list = (await app.http.get(path).query({ employeeId: flow.person.user.id }).set(auth(viewer)).expect(200)).body.data;
        expect(list.items.map((item: any) => item.id)).toEqual([flow.request.id]);
      }
      const detail = (await app.http.get(`${flow.route}/${flow.request.id}`).set(auth(viewer)).expect(200)).body.data;
      expect(detail).toMatchObject({ canApprove: false, canReturn: false, pendingRole: 'hr' });
      const pending = (await app.http.get(`${flow.route}/pending`).query({ employeeId: flow.person.user.id })
        .set(auth(viewer)).expect(200)).body.data;
      expect(pending.items).toEqual([]);
      await app.http.post(`${flow.route}/${flow.request.id}/approve`).set(auth(viewer))
        .send({ submissionVersion: flow.submissionVersion, voteResult: 'pass', voteComment: '指派身份不能代替 HR 办理',
          proposedRegularDate: flow.regularDate }).expect(403);
      expect(await app.prisma.confirmationApplication.findUniqueOrThrow({ where: { id: flow.request.id } }))
        .toMatchObject({ status: 'manager_approved', hrApprovedAt: null, voteResult: null });
    });
  });
});

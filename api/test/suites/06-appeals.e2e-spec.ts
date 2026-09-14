import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { CompanyCode, SysRole, TaskStatus } from '@prisma/client';

describe('06-HR appeal records', () => {
  let app: TestApp;
  let factory: FixtureFactory;

  beforeAll(async () => { app = await buildTestApp(); factory = new FixtureFactory(app.prisma); });
  afterAll(async () => { await closeTestApp(app); });
  beforeEach(async () => { await factory.resetDataTables(); });

  it('HR saves and supplements a personnel record without changing a published result', async () => {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    await app.prisma.employmentRecord.create({ data: { userId: hr.id, effectiveFrom: new Date('2020-01-01'), company: CompanyCode.fuede, deptId: dept.id, changeType: 'hire' } });
    const manager = await factory.createUser({ employeeNo: 'MGR001', name: '主管', sysRole: SysRole.manager, deptId: dept.id });
    const employee = await factory.createUser({ employeeNo: 'EMP001', name: '员工', sysRole: SysRole.employee, deptId: dept.id, directManagerId: manager.id });
    const cycle = await factory.createCycle({ name: '申诉记录周期', createdBy: hr.id });
    const task = await factory.createTaskInStatus({ cycleId: cycle.id, employeeId: employee.id, managerId: manager.id,
      status: TaskStatus.published, deptId: dept.id, hasManagerScore: true, calculatedScore: 82, rawGrade: 'B', calibratedGrade: 'B' });
    const before = await app.prisma.assessmentTask.findUniqueOrThrow({ where: { id: task.id }, include: { gradeResult: true, flowRecords: true, appeals: true } });
    const token = await login(app.http, { employeeNo: 'HR001', password: 'test123' });
    const createRes = await app.http.post('/api/v1/appeals').set('Authorization', `Bearer ${token}`)
      .send({ employeeId: employee.id, cycleId: cycle.id, receivedAt: '2026-09-14', subject: '考核等级依据', content: '希望核查评分依据' }).expect(201);
    expect(createRes.body.data).toMatchObject({ employeeId: employee.id, cycleId: cycle.id, subject: '考核等级依据', content: '希望核查评分依据', recordedByName: 'HR' });
    const id = createRes.body.data.id;
    const updateRes = await app.http.put(`/api/v1/appeals/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ cycleId: null, handlingNote: '已与主管沟通', conclusion: '记录完成' }).expect(200);
    expect(updateRes.body.data).toMatchObject({ cycleId: null, handlingNote: '已与主管沟通', conclusion: '记录完成' });
    const list = await app.http.get('/api/v1/appeals').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.data.items.map((item: { id: string }) => item.id)).toContain(id);
    expect(await app.prisma.assessmentTask.findUniqueOrThrow({ where: { id: task.id }, include: { gradeResult: true, flowRecords: true, appeals: true } })).toEqual(before);
    expect(await app.prisma.appeal.count()).toBe(0);
  });

  it('rejects the former task-linked request and direct regrade route', async () => {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    await app.prisma.employmentRecord.create({ data: { userId: hr.id, effectiveFrom: new Date('2020-01-01'), company: CompanyCode.fuede, deptId: dept.id, changeType: 'hire' } });
    const token = await login(app.http, { employeeNo: 'HR001', password: 'test123' });
    await app.http.post('/api/v1/appeals').set('Authorization', `Bearer ${token}`)
      .send({ taskId: '3e37aa10-728c-4cf0-98a7-46b52c6de716', reason: '旧流程参数' }).expect(400);
    await app.http.post('/api/v1/appeals/3e37aa10-728c-4cf0-98a7-46b52c6de716/resolve')
      .set('Authorization', `Bearer ${token}`).send({ result: 'modified', newGrade: 'A' }).expect(404);
  });
});

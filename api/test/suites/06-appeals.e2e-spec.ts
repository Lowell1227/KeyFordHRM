import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { assertNoCoefficientKey } from '../helpers/scoring-assertions';
import { SysRole, TaskStatus } from '@prisma/client';

describe('06-appeals', () => {
  let app: TestApp;
  let factory: FixtureFactory;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await factory.resetDataTables();
  });

  async function createRoleSet() {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    const manager = await factory.createUser({ employeeNo: 'MGR001', name: '主管', sysRole: SysRole.manager, deptId: dept.id });
    const employee = await factory.createUser({
      employeeNo: 'EMP001',
      name: '员工',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });
    return { dept, hr, manager, employee };
  }

  it('HR 录入申诉 → 改判 modified → gradeResult.calibratedGrade 更新 + 档案同步', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '申诉周期', createdBy: hr.id });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: 'B',
      calibratedGrade: 'B',
    });
    await app.prisma.gradeResult.updateMany({ where: { taskId: task.id }, data: { isPublished: true } });
    await app.prisma.performanceArchive.create({
      data: {
        employeeId: employee.id,
        cycleId: cycle.id,
        employeeName: employee.name,
        deptName: dept.name ?? null,
        grade: 'B',
        totalScore: 82,
      },
    });

    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    const createRes = await app.http
      .post('/api/v1/appeals')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ taskId: task.id, reason: '认为等级偏低' })
      .expect(200);
    const appealId = createRes.body.data.id;

    const resolveRes = await app.http
      .post(`/api/v1/appeals/${appealId}/resolve`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ result: 'modified', newGrade: 'A', resolution: '经复核，调整为 A' })
      .expect(200);

    expect(resolveRes.body.data.finalResult).toBe('modified');
    expect(resolveRes.body.data.taskGrade.calibratedGrade).toBe('A');
    assertNoCoefficientKey(resolveRes.body.data);

    const gradeResult = await app.prisma.gradeResult.findUnique({ where: { taskId: task.id } });
    expect(gradeResult?.calibratedGrade).toBe('A');

    const archive = await app.prisma.performanceArchive.findUnique({
      where: { employeeId_cycleId: { employeeId: employee.id, cycleId: cycle.id } },
    });
    expect(archive?.grade).toBe('A');
  });

  it('维持 maintained 只留痕，不改变等级', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '申诉周期', createdBy: hr.id });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: 'B',
      calibratedGrade: 'B',
    });

    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    const createRes = await app.http
      .post('/api/v1/appeals')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ taskId: task.id, reason: '认为等级偏低' })
      .expect(200);

    const resolveRes = await app.http
      .post(`/api/v1/appeals/${createRes.body.data.id}/resolve`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ result: 'maintained', resolution: '维持原判' })
      .expect(200);

    expect(resolveRes.body.data.finalResult).toBe('maintained');

    const gradeResult = await app.prisma.gradeResult.findUnique({ where: { taskId: task.id } });
    expect(gradeResult?.calibratedGrade).toBe('B');

    const audit = await app.prisma.auditLog.findFirst({ where: { entityType: 'appeal', action: 'resolve_appeal' } });
    expect(audit).toBeTruthy();
  });

  it('废弃路由返回 404', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '申诉周期', createdBy: hr.id });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: 'B',
      calibratedGrade: 'B',
    });

    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    await app.http.post('/api/v1/appeals').set('Authorization', `Bearer ${hrToken}`).send({ taskId: task.id, reason: 'x' }).expect(200);

    await app.http.post('/api/v1/appeals/123/dept-resolve').set('Authorization', `Bearer ${hrToken}`).expect(404);
    await app.http.post('/api/v1/appeals/123/withdraw').set('Authorization', `Bearer ${hrToken}`).expect(404);
    await app.http.get('/api/v1/appeals/mine').set('Authorization', `Bearer ${hrToken}`).expect(404);
  });
});

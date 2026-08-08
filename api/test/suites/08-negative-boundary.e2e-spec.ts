import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { SysRole, TaskStatus, CycleStatus } from '@prisma/client';

describe('08-negative-boundary', () => {
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
    const deptHead = await factory.createUser({ employeeNo: 'DEPT001', name: '部门负责人', sysRole: SysRole.dept_head, deptId: dept.id });
    const approver = await factory.createUser({ employeeNo: 'VP001', name: '审批人', sysRole: SysRole.vp, deptId: dept.id });
    const employee = await factory.createUser({
      employeeNo: 'EMP001',
      name: '员工',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });
    const otherEmployee = await factory.createUser({
      employeeNo: 'EMP002',
      name: '员工B',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });

    await factory.updateDeptLeader(dept.id, deptHead.id);
    await factory.updateDeptApprover(dept.id, approver.id);

    return { dept, hr, manager, deptHead, approver, employee, otherEmployee };
  }

  it('未自评直接主管评分 → 409', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '非法流转', createdBy: hr.id });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.indicator_setting,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: 'B',
    });

    const mgrToken = await login(app.http, { employeeNo: 'MGR001', password: 'test123' });

    const res = await app.http
      .post(`/api/v1/tasks/${task.id}/manager-score`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ expectedUpdatedAt: task.updatedAt.toISOString(), indicators: [], evalSummary: {} })
      .expect(409);
    expect(res.body.code).toBe(4009);
  });

  it('未审批直接公示 → 409', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '非法公示', createdBy: hr.id, status: CycleStatus.hr_calibration });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.hr_calibration,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: 'B',
      calibratedGrade: 'B',
    });

    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    const res = await app.http
      .post(`/api/v1/cycles/${cycle.id}/publish`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ taskIds: [task.id] })
      .expect(409);
    expect(res.body.code).toBe(4009);
  });

  it('未校准直接审批 → 409', async () => {
    const { dept, hr, manager, approver, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '非法审批', createdBy: hr.id });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.dept_review,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: 'B',
    });

    const approverToken = await login(app.http, { employeeNo: 'VP001', password: 'test123' });

    const res = await app.http
      .post(`/api/v1/cycles/${cycle.id}/approval`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ taskIds: [task.id] })
      .expect(409);
    expect(res.body.code).toBe(4009);
  });

  it('自评分越界 → 400', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '越界', createdBy: hr.id });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.self_eval,
      deptId: dept.id,
    });

    const empToken = await login(app.http, { employeeNo: 'EMP001', password: 'test123' });
    const instance = await app.prisma.indicatorInstance.findFirstOrThrow({ where: { taskId: task.id } });

    const res = await app.http
      .post(`/api/v1/tasks/${task.id}/self-eval`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ indicators: [{ id: instance.id, selfScore: 101 }], summary: {} })
      .expect(400);
    expect(res.body.code).toBe(4001);
  });

  it('员工改他人任务 → 403', async () => {
    const { dept, hr, manager, employee, otherEmployee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '越权', createdBy: hr.id });
    const otherTask = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: otherEmployee.id,
      managerId: manager.id,
      status: TaskStatus.self_eval,
      deptId: dept.id,
    });

    const empToken = await login(app.http, { employeeNo: 'EMP001', password: 'test123' });

    const res = await app.http
      .post(`/api/v1/tasks/${otherTask.id}/self-eval`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ indicators: [], summary: {} })
      .expect(403);
    expect(res.body.code).toBe(4003);
  });

  it('主管评不归自己的人 → 403', async () => {
    const { dept, hr, employee } = await createRoleSet();
    const otherManager = await factory.createUser({
      employeeNo: 'MGR002',
      name: '主管B',
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    const cycle = await factory.createCycle({ name: '越权', createdBy: hr.id });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: otherManager.id,
      status: TaskStatus.manager_scoring,
      deptId: dept.id,
    });

    const mgrToken = await login(app.http, { employeeNo: 'MGR001', password: 'test123' });

    const res = await app.http
      .post(`/api/v1/tasks/${task.id}/manager-score`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ expectedUpdatedAt: task.updatedAt.toISOString(), indicators: [], evalSummary: {} })
      .expect(403);
    expect(res.body.code).toBe(4003);
  });

  it('不存在 id → 404', async () => {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    const res = await app.http.get('/api/v1/tasks/00000000-0000-0000-0000-000000000000').set('Authorization', `Bearer ${hrToken}`).expect(404);
    expect(res.body.code).toBe(4004);
  });

  it('缺必填 → 400', async () => {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    const res = await app.http
      .post('/api/v1/cycles')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ name: '' })
      .expect(400);
    expect(res.body.code).toBe(4001);
  });

  it('重复公示同任务 → 409', async () => {
    const { dept, hr, manager, approver, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '重复公示', createdBy: hr.id, status: CycleStatus.approval });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.approval,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 82,
      rawGrade: 'B',
      calibratedGrade: 'B',
    });
    await app.prisma.gradeResult.updateMany({ where: { taskId: task.id }, data: { approvedAt: new Date() } });

    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    await app.http
      .post(`/api/v1/cycles/${cycle.id}/publish`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ taskIds: [task.id] })
      .expect(200);

    const res = await app.http
      .post(`/api/v1/cycles/${cycle.id}/publish`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ taskIds: [task.id] })
      .expect(409);
    expect(res.body.code).toBe(4009);
  });

  it('对同任务重复建 pending 申诉 → 409', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '重复申诉', createdBy: hr.id });
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

    await app.http
      .post('/api/v1/appeals')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ taskId: task.id, reason: '第一次' })
      .expect(200);

    const res = await app.http
      .post('/api/v1/appeals')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ taskId: task.id, reason: '第二次' })
      .expect(409);
    expect(res.body.code).toBe(4009);
  });
});

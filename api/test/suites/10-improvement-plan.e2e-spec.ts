import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login, authHeader } from '../helpers/auth-helper';
import { SysRole, TaskStatus, CycleStatus, PerfGrade, Prisma } from '@prisma/client';
import { SchedulerService } from '@/scheduler/scheduler.service';

describe('10-improvement-plan', () => {
  let app: TestApp;
  let factory: FixtureFactory;
  let schedulerService: SchedulerService;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
    schedulerService = app.app.get(SchedulerService);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await factory.resetDataTables();
  });

  async function createRoleSet() {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({
      employeeNo: 'HR001',
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: dept.id,
    });
    const manager = await factory.createUser({
      employeeNo: 'MGR001',
      name: '主管',
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    const employee = await factory.createUser({
      employeeNo: 'EMP001',
      name: '员工',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });
    return { dept, hr, manager, employee };
  }

  it('验收 A：D 等级公示后自动生成 draft 绩效改进计划', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();

    const cycle = await factory.createCycle({
      name: 'PIP触发周期',
      createdBy: hr.id,
      status: CycleStatus.approval,
    });

    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      deptHeadId: manager.id,
      status: TaskStatus.approval,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 55,
      rawGrade: PerfGrade.D,
      calibratedGrade: PerfGrade.D,
    });

    // 补充审批通过时间，满足 publish 前置条件
    await app.prisma.gradeResult.update({
      where: { taskId: task.id },
      data: { approvedAt: new Date(), approverId: hr.id },
    });

    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    await app.http
      .post(`/api/v1/cycles/${cycle.id}/publish`)
      .set(authHeader(hrToken))
      .send({ taskIds: [task.id] })
      .expect(200);

    const plan = await app.prisma.improvementPlan.findFirst({
      where: { employeeId: employee.id, cycleId: cycle.id },
    });

    expect(plan).toBeTruthy();
    expect(plan?.status).toBe('draft');
    expect(plan?.taskId).toBe(task.id);

    // 员工状态未被改动
    const updatedEmployee = await app.prisma.user.findUnique({ where: { id: employee.id } });
    expect(updatedEmployee?.status).toBe('active');
  });

  it('验收 B：连续两次 D 触发预警且不自动处置员工', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();

    // 第一个 D 周期
    const cycle1 = await factory.createCycle({
      name: 'D周期1',
      createdBy: hr.id,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-03-31'),
    });
    const task1 = await factory.createTaskInStatus({
      cycleId: cycle1.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 55,
      rawGrade: PerfGrade.D,
      calibratedGrade: PerfGrade.D,
    });
    await app.prisma.assessmentCycle.update({
      where: { id: cycle1.id },
      data: { status: CycleStatus.published, deadlineAppeal: new Date('2026-01-01') },
    });
    await app.prisma.performanceArchive.create({
      data: {
        employeeId: employee.id,
        cycleId: cycle1.id,
        employeeName: employee.name,
        deptName: dept.name,
        grade: PerfGrade.D,
        totalScore: new Prisma.Decimal(55),
        archivedAt: new Date('2026-04-01'),
      },
    });

    // 第二个 D 周期
    const cycle2 = await factory.createCycle({
      name: 'D周期2',
      createdBy: hr.id,
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-06-30'),
    });
    const task2 = await factory.createTaskInStatus({
      cycleId: cycle2.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
      hasManagerScore: true,
      calculatedScore: 50,
      rawGrade: PerfGrade.D,
      calibratedGrade: PerfGrade.D,
    });
    await app.prisma.assessmentCycle.update({
      where: { id: cycle2.id },
      data: { status: CycleStatus.published, deadlineAppeal: new Date('2026-04-01') },
    });
    await app.prisma.performanceArchive.create({
      data: {
        employeeId: employee.id,
        cycleId: cycle2.id,
        employeeName: employee.name,
        deptName: dept.name,
        grade: PerfGrade.D,
        totalScore: new Prisma.Decimal(50),
        archivedAt: new Date('2026-07-01'),
      },
    });

    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    const res = await app.http
      .get('/api/v1/reports/consecutive-d-warning')
      .set(authHeader(hrToken))
      .expect(200);

    expect(res.body.code).toBe(0);
    const items = res.body.data;
    expect(Array.isArray(items)).toBe(true);
    const warning = items.find((item: any) => item.employeeId === employee.id);
    expect(warning).toBeTruthy();
    expect(warning.consecutiveCount).toBeGreaterThanOrEqual(2);

    // 员工状态/任何业务数据未被自动改动
    const updatedEmployee = await app.prisma.user.findUnique({ where: { id: employee.id } });
    expect(updatedEmployee?.status).toBe('active');
  });

  it('主管可填写 draft 计划并录入最终评分完成', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();

    const cycle = await factory.createCycle({ name: '填写周期', createdBy: hr.id });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
    });
    const plan = await app.prisma.improvementPlan.create({
      data: {
        employeeId: employee.id,
        cycleId: cycle.id,
        taskId: task.id,
        status: 'draft',
      },
    });

    const managerToken = await login(app.http, { employeeNo: 'MGR001', password: 'test123' });

    const fillRes = await app.http
      .post(`/api/v1/improvement-plans/${plan.id}/fill`)
      .set(authHeader(managerToken))
      .send({
        improvementNeed: '业务能力不足',
        importance: '影响团队产出',
        improvementGoal: '达到岗位要求',
        targetDate: '2026-07-01',
        measures: [{ description: '参加培训', responsible: '员工', deadline: '2026-06-15' }],
      })
      .expect(200);

    expect(fillRes.body.data.status).toBe('in_progress');

    const completeRes = await app.http
      .post(`/api/v1/improvement-plans/${plan.id}/complete`)
      .set(authHeader(managerToken))
      .send({ finalScore: 8 })
      .expect(200);

    expect(completeRes.body.data.status).toBe('completed');
    expect(completeRes.body.data.finalScore).toBe(8);
  });

  it('员工可查看自己的计划，不能查看他人计划', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();

    const employeeB = await factory.createUser({
      employeeNo: 'EMP002',
      name: '员工B',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });

    const cycle = await factory.createCycle({ name: '权限周期', createdBy: hr.id });
    const taskA = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
    });
    const taskB = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employeeB.id,
      managerId: manager.id,
      status: TaskStatus.published,
      deptId: dept.id,
    });
    const planA = await app.prisma.improvementPlan.create({
      data: {
        employeeId: employee.id,
        cycleId: cycle.id,
        taskId: taskA.id,
        status: 'draft',
      },
    });
    const planB = await app.prisma.improvementPlan.create({
      data: {
        employeeId: employeeB.id,
        cycleId: cycle.id,
        taskId: taskB.id,
        status: 'draft',
      },
    });

    const empToken = await login(app.http, { employeeNo: 'EMP001', password: 'test123' });

    await app.http.get(`/api/v1/improvement-plans/${planA.id}`).set(authHeader(empToken)).expect(200);
    await app.http.get(`/api/v1/improvement-plans/${planB.id}`).set(authHeader(empToken)).expect(403);
  });
});

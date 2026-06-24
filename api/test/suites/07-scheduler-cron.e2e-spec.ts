import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { SysRole, TaskStatus, CycleStatus } from '@prisma/client';
import { NotificationsService } from '@/notifications/notifications.service';
import { SchedulerService } from '@/scheduler/scheduler.service';
import { DingtalkSyncService } from '@/dingtalk/dingtalk-sync.service';

describe('07-scheduler-cron', () => {
  let app: TestApp;
  let factory: FixtureFactory;
  let notificationsService: NotificationsService;
  let schedulerService: SchedulerService;
  let dingtalkSyncService: DingtalkSyncService;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
    notificationsService = app.app.get(NotificationsService);
    schedulerService = app.app.get(SchedulerService);
    dingtalkSyncService = app.app.get(DingtalkSyncService);
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

  it('单条催办：同人同 sender 当日第二次返回 4029', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '催办周期', createdBy: hr.id });
    const task = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.self_eval,
      deptId: dept.id,
    });

    await notificationsService.sendTaskReminder(task.id, 'employee', hr.id);

    await expect(notificationsService.sendTaskReminder(task.id, 'employee', hr.id)).rejects.toMatchObject({
      response: { code: 4029 },
    });
  });

  it('批量催办：已完成该节点的人不收催办', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({
      name: '批量催办周期',
      createdBy: hr.id,
      status: CycleStatus.self_eval,
      deadlineSelfEval: new Date('2026-01-01'),
    });

    // 员工 A 在 self_eval 节点
    const taskA = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.self_eval,
      deptId: dept.id,
    });

    // 员工 B 已经理评分（不在 self_eval）
    const employeeB = await factory.createUser({
      employeeNo: 'EMP002',
      name: '员工B',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });
    await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employeeB.id,
      managerId: manager.id,
      status: TaskStatus.manager_scoring,
      deptId: dept.id,
    });

    await schedulerService.runDeadlineReminders();

    const logs = await app.prisma.notificationLog.findMany({
      where: { cycleId: cycle.id, type: 'task_reminder' },
    });

    const remindedEmployeeIds = new Set(logs.map((l) => l.userId));
    expect(remindedEmployeeIds.has(employee.id)).toBe(true);
    expect(remindedEmployeeIds.has(employeeB.id)).toBe(false);
  });

  it('钉钉同步 cron 被调用、不真连', async () => {
    const spy = jest.spyOn(dingtalkSyncService, 'runSync');
    await schedulerService.syncDingtalkOrganization();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('关周期归档：过公示截止日后任务 closed 并写入 performance_archive', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '归档周期', createdBy: hr.id });
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

    await app.prisma.assessmentCycle.update({
      where: { id: cycle.id },
      data: { status: CycleStatus.published, deadlineAppeal: new Date('2026-01-01') },
    });

    await schedulerService.runAutoCloseCycles();

    const closedCycle = await app.prisma.assessmentCycle.findUnique({ where: { id: cycle.id } });
    expect(closedCycle?.status).toBe('closed');

    const closedTask = await app.prisma.assessmentTask.findUnique({ where: { id: task.id } });
    expect(closedTask?.status).toBe('closed');

    const archive = await app.prisma.performanceArchive.findFirst({
      where: { cycleId: cycle.id, employeeId: employee.id },
    });
    expect(archive).toBeTruthy();
  });
});
